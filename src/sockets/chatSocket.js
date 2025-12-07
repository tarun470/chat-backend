// socket-handlers.js (Optimized Version)
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import crypto from "crypto";
import Message from "../models/Message.js";
import User from "../models/User.js";

const onlineUsers = new Map(); // { userId: { socketId, username, nickname, avatar } }

// ============================
// Utility: Generate Secure DM Room ID
// ============================
const getDMRoom = (id1, id2) => {
  const sorted = [id1.toString(), id2.toString()].sort().join("|");
  return "dm:" + crypto.createHash("sha256").update(sorted).digest("hex").slice(0, 20);
};

// ============================
// Utility: Rate Limiting (Anti-Spam)
// ============================
const lastEvent = new Map();
const rateLimit = (socket, event, ms) => {
  const key = `${socket.id}:${event}`;
  const now = Date.now();
  if (lastEvent.has(key) && now - lastEvent.get(key) < ms) return false;
  lastEvent.set(key, now);
  return true;
};

// ============================
// MAIN HANDLER
// ============================
export const handleChatSocket = (io) => {
  // ------------------------------------
  // AUTH MIDDLEWARE
  // ------------------------------------
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error("No token provided"));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select("username nickname avatar blockedUsers");

      if (!user) return next(new Error("User not found"));

      socket.userId = user._id.toString();
      socket.userData = user;

      next();
    } catch (err) {
      console.error("Socket Auth Error:", err.message);
      next(new Error("Authentication Error"));
    }
  });

  // ------------------------------------
  // CONNECTION
  // ------------------------------------
  io.on("connection", async (socket) => {
    const userId = socket.userId;

    console.log(`🔵 Connected: ${userId} | socket ${socket.id}`);

    // Save in online memory map
    onlineUsers.set(userId, {
      socketId: socket.id,
      username: socket.userData.username,
      nickname: socket.userData.nickname,
      avatar: socket.userData.avatar,
    });

    // Join personal + global room
    socket.join(userId);
    socket.join("global");

    // Mark online in DB
    User.findByIdAndUpdate(userId, {
      isOnline: true,
      socketId: socket.id,
      lastSeen: new Date(),
    }).catch(() => {});

    emitOnlineUsers(io);

    // ============================
    // Helper: Lean Message Formatting
    // ============================
    const buildPayload = (m) => {
      if (!m) return null;

      const reactions = {};
      (m.reactions || []).forEach((r) => {
        reactions[r.emoji] = (reactions[r.emoji] || 0) + 1;
      });

      return {
        _id: m._id,
        sender: m.sender
          ? {
              _id: m.sender._id,
              username: m.sender.username,
              nickname: m.sender.nickname,
              avatar: m.sender.avatar,
            }
          : null,
        content: m.content,
        type: m.type,
        fileUrl: m.fileUrl,
        fileName: m.fileName,
        roomId: m.roomId,
        replyTo: m.replyTo?._id || null,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        deliveredTo: (m.deliveredTo || []).map(String),
        seenBy: (m.seenBy || []).map(String),
        edited: !!m.edited,
        reactions,
        deletedForEveryone: m.deletedForEveryone || false,
      };
    };

    const fetchMsg = async (id) =>
      Message.findById(id)
        .populate("sender", "username nickname avatar")
        .populate({
          path: "replyTo",
          populate: { path: "sender", select: "username nickname avatar" },
        })
        .lean();

    // ============================
    // Helper: Fast Recipients
    // ============================
    const getRecipients = async (roomId, exclude) => {
      const room = io.sockets.adapter.rooms.get(roomId) || new Set();
      return [...room]
        .map((sid) => io.sockets.sockets.get(sid)?.userId)
        .filter((uid) => uid && uid !== exclude);
    };

    // ============================
    // SEND MESSAGE
    // ============================
    socket.on("sendMessage", async (data = {}) => {
      if (!rateLimit(socket, "sendMessage", 150)) return;

      try {
        const { content, roomId, receiver, type, replyTo, fileUrl, fileName, tempId } = data;
        if ((!content || !content.trim()) && !fileUrl) return;

        // ENFORCE BLOCKING
        if (receiver) {
          const recv = await User.findById(receiver).select("blockedUsers");
          if (recv?.blockedUsers?.includes(socket.userId)) return;
        }

        // Room logic
        let finalRoom = roomId || "global";
        if (receiver && !roomId) finalRoom = getDMRoom(userId, receiver);

        const msg = await Message.create({
          sender: userId,
          receiver: receiver || null,
          roomId: finalRoom,
          content: content || "",
          type: type || (fileUrl ? "file" : "text"),
          fileUrl,
          fileName,
          replyTo: replyTo || null,
        });

        const doc = await fetchMsg(msg._id);
        const payload = buildPayload(doc);

        // Emit
        if (receiver) {
          io.to(receiver).emit("receiveMessage", payload);
        }
        socket.emit("receiveMessage", payload);
        io.to(finalRoom).emit("receiveMessage", payload);

        // Mark Delivered for active users
        const rec = await getRecipients(finalRoom, payload.sender._id);
        if (rec.length)
          Message.findByIdAndUpdate(msg._id, { $addToSet: { deliveredTo: rec } }).catch(() => {});

      } catch (err) {
        console.error("sendMessage:", err.message);
      }
    });

    // ============================
    // MESSAGE SEEN
    // ============================
    socket.on("seen", async ({ messageId }) => {
      if (!rateLimit(socket, "seen", 80)) return;
      try {
        if (!messageId) return;

        const msg = await Message.findById(messageId);
        if (!msg) return;

        if (!msg.seenBy.includes(userId)) {
          msg.seenBy.push(userId);
          await msg.save();
        }

        io.to(msg.sender.toString()).emit("messageSeen", {
          messageId,
          userId,
        });
      } catch (err) {
        console.error("seen:", err.message);
      }
    });

    // ============================
    // EDIT MESSAGE
    // ============================
    socket.on("editMessage", async ({ messageId, content }) => {
      if (!rateLimit(socket, "editMessage", 200)) return;
      try {
        const msg = await Message.findById(messageId);
        if (!msg || msg.sender.toString() !== userId) return;

        msg.content = content;
        msg.edited = true;
        await msg.save();

        const updated = await fetchMsg(messageId);
        const payload = buildPayload(updated);

        const rec = await getRecipients(payload.roomId, userId);
        rec.forEach((id) => io.to(id).emit("messageEdited", payload));
        socket.emit("messageEdited", payload);

      } catch (err) {
        console.error("editMessage:", err.message);
      }
    });

    // ============================
    // DELETE MESSAGE
    // ============================
    socket.on("deleteMessage", async ({ messageId, forEveryone }) => {
      if (!rateLimit(socket, "deleteMessage", 200)) return;

      try {
        const msg = await Message.findById(messageId);
        if (!msg) return;

        const isSender = msg.sender.toString() === userId.toString();

        if (forEveryone && isSender) {
          msg.deletedForEveryone = true;
          await msg.save();
          io.to(msg.roomId).emit("messageDeleted", { messageId, forEveryone: true });
        } else {
          msg.deletedFor = msg.deletedFor || [];
          if (!msg.deletedFor.includes(userId)) msg.deletedFor.push(userId);
          await msg.save();

          socket.emit("messageDeleted", { messageId, forEveryone: false });
        }
      } catch (err) {
        console.error("deleteMessage:", err.message);
      }
    });

    // ============================
    // REACTIONS
    // ============================
    socket.on("addReaction", async ({ messageId, emoji }) => {
      if (!rateLimit(socket, "reaction", 150)) return;

      const allowed = ["❤️", "😂", "🔥", "👍", "👎", "😢"];
      if (!allowed.includes(emoji)) return;

      try {
        const msg = await Message.findById(messageId);
        if (!msg) return;

        const idx = msg.reactions.findIndex(
          (r) => r.user.toString() === userId && r.emoji === emoji
        );

        if (idx === -1) msg.reactions.push({ emoji, user: userId });
        else msg.reactions.splice(idx, 1);

        await msg.save();

        const reactions = {};
        msg.reactions.forEach((r) => {
          reactions[r.emoji] = (reactions[r.emoji] || 0) + 1;
        });

        io.to(msg.roomId).emit("reactionUpdated", {
          messageId,
          reactions,
        });

      } catch (err) {
        console.error("reaction:", err.message);
      }
    });

    // ============================
    // USER TYPING
    // ============================
    socket.on("typing", ({ roomId, isTyping, receiver }) => {
      if (!rateLimit(socket, "typing", 80)) return;

      const payload = {
        userId,
        username: socket.userData.username,
        isTyping: !!isTyping,
      };

      if (receiver) io.to(receiver).emit("typing", payload);
      else io.to(roomId || "global").emit("typing", payload);
    });

    // ============================
    // DISCONNECT
    // ============================
    socket.on("disconnect", async () => {
      onlineUsers.delete(userId);

      User.findByIdAndUpdate(userId, {
        isOnline: false,
        lastSeen: new Date(),
        socketId: null,
      }).catch(() => {});

      emitOnlineUsers(io);

      console.log(`🔴 Disconnected: ${userId}`);
    });
  });

  // ============================
  // ONLINE USERS (No DB Query!)
  // ============================
  const emitOnlineUsers = (io) => {
    const usersObj = {};
    for (const [id, data] of onlineUsers.entries()) {
      usersObj[id] = {
        username: data.username,
        nickname: data.nickname,
        avatar: data.avatar,
        isOnline: true,
      };
    }

    io.emit("onlineUsers", {
      count: onlineUsers.size,
      users: usersObj,
    });
  };
};
