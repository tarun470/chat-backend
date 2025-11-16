import jwt from "jsonwebtoken";
import Message from "../models/Message.js";
import User from "../models/User.js";
import mongoose from "mongoose";

const onlineUsers = new Map(); // userId -> { socketId, username, lastSeen, isOnline }

/**
 * Initialize Socket.IO chat
 * @param {import("socket.io").Server} io
 */
export const handleChatSocket = (io) => {
  // ✅ Socket auth middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error("Auth error: No token"));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;

      const user = await User.findById(decoded.id).select("username");
      socket.username = user ? user.username : "Unknown";

      next();
    } catch (err) {
      console.error("Socket auth error:", err.message);
      next(new Error("Authentication error"));
    }
  });

  // ✅ Connection handler
  io.on("connection", async (socket) => {
    const userId = socket.userId;
    console.log(`✅ Socket connected: ${socket.id} | user=${userId}`);

    // register online
    onlineUsers.set(userId.toString(), { socketId: socket.id, username: socket.username, isOnline: true, lastSeen: null });

    // join personal room
    socket.join(userId.toString());
    // join global room
    socket.join("global");

    // update DB
    try {
      await User.findByIdAndUpdate(userId, { isOnline: true, socketId: socket.id }, { new: true });
    } catch {}

    emitOnlineUsers(io);

    // ---------- EVENTS ----------

    // sendMessage
    socket.on("sendMessage", async (data) => {
      try {
        const { content, roomId, type, receiver, replyTo, fileUrl, fileName } = data || {};
        if ((type === "text" && (!content || !content.trim())) && !fileUrl) return;

        const msg = await Message.create({
          sender: mongoose.Types.ObjectId(userId),
          receiver: receiver ? mongoose.Types.ObjectId(receiver) : null,
          roomId: roomId || (receiver ? `dm:${[userId, receiver].sort().join(":")}` : "global"),
          content: content || "",
          type: type || (fileUrl ? "file" : "text"),
          fileUrl: fileUrl || null,
          fileName: fileName || null,
          replyTo: replyTo || null,
        });

        const populated = await Message.findById(msg._id).populate("sender", "username nickname avatar");
        const payload = messageToPayload(populated);

        if (receiver) {
          io.to(receiver.toString()).emit("receiveMessage", payload);
          socket.emit("receiveMessage", payload);
        } else {
          io.to(payload.roomId).emit("receiveMessage", payload);
        }

        const recipients = await computeRecipientsForMessage(payload, io);
        if (recipients.length > 0) {
          await Message.findByIdAndUpdate(msg._id, { $addToSet: { deliveredTo: { $each: recipients.map(id => mongoose.Types.ObjectId(id)) } } });
          io.to(payload.roomId).emit("messageDelivered", { messageId: payload._id, deliveredTo: recipients });
        }
      } catch (err) {
        console.error("sendMessage error:", err.message);
      }
    });

    // typing
    socket.on("typing", (data) => {
      const { roomId, isTyping, receiver } = data || {};
      if (receiver) {
        io.to(receiver.toString()).emit("typing", { userId, username: socket.username, isTyping });
      } else {
        io.to(roomId || "global").emit("typing", { userId, username: socket.username, isTyping });
      }
    });

    // delivered
    socket.on("delivered", async ({ messageId }) => {
      if (!messageId) return;
      const msg = await Message.findById(messageId);
      if (!msg) return;
      if (!msg.deliveredTo.map(String).includes(userId.toString())) {
        msg.deliveredTo.push(userId);
        await msg.save();
      }
      io.to(msg.roomId).emit("messageDelivered", { messageId: msg._id.toString(), deliveredTo: msg.deliveredTo.map(String) });
    });

    // seen
    socket.on("seen", async ({ messageId }) => {
      if (!messageId) return;
      const msg = await Message.findById(messageId);
      if (!msg) return;
      if (!msg.seenBy.map(String).includes(userId.toString())) {
        msg.seenBy.push(userId);
        await msg.save();
      }
      io.to(msg.roomId).emit("messageSeen", { messageId: msg._id.toString(), seenBy: msg.seenBy.map(String) });
    });

    // editMessage
    socket.on("editMessage", async ({ messageId, content }) => {
      if (!messageId) return;
      const msg = await Message.findById(messageId);
      if (!msg || msg.sender.toString() !== userId.toString()) return;
      msg.content = content;
      msg.edited = true;
      await msg.save();
      const payload = messageToPayload(await msg.populate("sender", "username nickname avatar"));
      io.to(msg.roomId).emit("messageEdited", payload);
    });

    // deleteMessage
    socket.on("deleteMessage", async ({ messageId, forEveryone }) => {
      if (!messageId) return;
      const msg = await Message.findById(messageId);
      if (!msg) return;
      if (forEveryone) {
        if (msg.sender.toString() !== userId.toString()) return;
        msg.deletedForEveryone = true;
        await msg.save();
        io.to(msg.roomId).emit("messageDeleted", { messageId: msg._id.toString(), forEveryone: true });
      } else {
        msg.deletedFor = msg.deletedFor || [];
        if (!msg.deletedFor.map(String).includes(userId.toString())) {
          msg.deletedFor.push(userId);
          await msg.save();
        }
        socket.emit("messageDeleted", { messageId: msg._id.toString(), forEveryone: false });
      }
    });

    // addReaction
    socket.on("addReaction", async ({ messageId, emoji }) => {
      if (!messageId || !emoji) return;
      const msg = await Message.findById(messageId);
      if (!msg) return;
      const existsIndex = msg.reactions.findIndex(r => r.emoji === emoji && r.user.toString() === userId.toString());
      if (existsIndex === -1) {
        msg.reactions.push({ emoji, user: mongoose.Types.ObjectId(userId) });
      } else {
        msg.reactions.splice(existsIndex, 1);
      }
      await msg.save();

      const counts = {};
      msg.reactions.forEach(r => counts[r.emoji] = (counts[r.emoji] || 0) + 1);
      io.to(msg.roomId).emit("reactionUpdated", { messageId: msg._id.toString(), reactions: counts });
    });

    // getRooms
    socket.on("getRooms", async () => {
      const rooms = Array.from(io.sockets.adapter.rooms.keys()).filter(r => !io.sockets.sockets.get(r));
      socket.emit("roomsList", rooms);
    });

    // disconnect
    socket.on("disconnect", async (reason) => {
      console.log(`🔌 Socket disconnected: ${socket.id} | user=${userId} | reason=${reason}`);
      onlineUsers.delete(userId.toString());
      try {
        await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen: new Date(), socketId: null });
      } catch {}
      emitOnlineUsers(io);
    });
  });

  // ---------------- HELPERS ----------------

  const emitOnlineUsers = async (io) => {
    try {
      const users = await User.find({}, "username isOnline lastSeen").lean();
      const count = users.filter(u => u.isOnline).length;
      const usersMap = {};
      users.forEach(u => { usersMap[u._id] = { username: u.username, isOnline: !!u.isOnline, lastSeen: u.lastSeen }; });
      io.emit("onlineUsers", { count, users: usersMap });
    } catch (err) {
      console.error("emitOnlineUsers error:", err.message);
    }
  };

  const messageToPayload = (m) => {
    const reactionsCount = {};
    (m.reactions || []).forEach((r) => reactionsCount[r.emoji] = (reactionsCount[r.emoji] || 0) + 1);
    return {
      _id: m._id.toString(),
      sender: m.sender ? { _id: m.sender._id ? m.sender._id.toString() : m.sender.toString(), username: m.sender.username, nickname: m.sender.nickname } : null,
      content: m.content,
      type: m.type,
      fileUrl: m.fileUrl,
      fileName: m.fileName,
      roomId: m.roomId,
      replyTo: m.replyTo ? m.replyTo._id || m.replyTo : null,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      deliveredTo: (m.deliveredTo || []).map(String),
      seenBy: (m.seenBy || []).map(String),
      edited: !!m.edited,
      reactions: reactionsCount,
      deletedForEveryone: !!m.deletedForEveryone,
    };
  };

  const computeRecipientsForMessage = async (payload, io) => {
    try {
      if (payload.roomId && payload.roomId !== "global") {
        if (payload.roomId.startsWith("dm:")) {
          const parts = payload.roomId.split(":")[1].split(":");
          return parts.filter(p => p !== payload.sender?._id).map(String);
        }
        const sockets = await io.in(payload.roomId).fetchSockets();
        return sockets.map(s => s.userId).filter(Boolean).filter(id => id !== payload.sender?._id);
      } else {
        const sockets = await io.fetchSockets();
        return sockets.map(s => s.userId).filter(Boolean).filter(id => id !== payload.sender?._id);
      }
    } catch (err) {
      console.error("computeRecipientsForMessage error:", err);
      return [];
    }
  };
};

