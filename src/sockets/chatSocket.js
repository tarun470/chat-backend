// socket-handlers.js
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
  // -------------------------
  // AUTH MIDDLEWARE
  // -------------------------
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

  // -------------------------
  // CONNECTION
  // -------------------------
  io.on("connection", async (socket) => {
    const userId = socket.userId;
    console.log(`✅ Socket connected: ${socket.id} | user=${userId}`);

    // register online
    onlineUsers.set(userId.toString(), { socketId: socket.id, username: socket.username, isOnline: true, lastSeen: null });

    // join personal room (userId) and global
    socket.join(userId.toString());
    socket.join("global");

    // update DB
    try {
      await User.findByIdAndUpdate(userId, { isOnline: true, socketId: socket.id }, { new: true });
    } catch (e) {
      console.warn("Warning updating user socketId/isOnline:", e.message);
    }

    emitOnlineUsers(io);

    // -------------------------
    // HELPERS
    // -------------------------
    const safeMessagePayload = async (msgDoc) => {
      const populated = await Message.findById(msgDoc._id).populate("sender", "username nickname avatar");
      return messageToPayload(populated);
    };

    const computeRecipientsForMessage = async (payload) => {
      try {
        if (payload.roomId && payload.roomId !== "global") {
          if (payload.roomId.startsWith("dm:")) {
            const parts = payload.roomId.split(":").slice(1);
            const senderId = payload.sender?._id || payload.sender;
            return parts.filter(p => p !== senderId).map(String);
          }
          const sockets = await io.in(payload.roomId).fetchSockets();
          return sockets.map(s => s.userId).filter(Boolean).filter(id => id !== (payload.sender?._id || payload.sender));
        } else {
          const sockets = await io.fetchSockets();
          return sockets.map(s => s.userId).filter(Boolean).filter(id => id !== (payload.sender?._id || payload.sender));
        }
      } catch (err) {
        console.error("computeRecipientsForMessage error:", err);
        return [];
      }
    };

    const messageToPayload = (m) => {
      const reactionsCount = {};
      (m.reactions || []).forEach((r) => reactionsCount[r.emoji] = (reactionsCount[r.emoji] || 0) + 1);
      return {
        _id: m._id.toString(),
        sender: m.sender ? { _id: m.sender._id.toString(), username: m.sender.username, nickname: m.sender.nickname } : null,
        content: m.content,
        type: m.type,
        fileUrl: m.fileUrl,
        fileName: m.fileName,
        roomId: m.roomId,
        replyTo: m.replyTo ? (m.replyTo._id ? m.replyTo._id.toString() : m.replyTo) : null,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        deliveredTo: (m.deliveredTo || []).map(String),
        seenBy: (m.seenBy || []).map(String),
        edited: !!m.edited,
        reactions: reactionsCount,
        deletedForEveryone: !!m.deletedForEveryone,
      };
    };

    // -------------------------
    // EVENTS
    // -------------------------

    // SEND MESSAGE
    socket.on("sendMessage", async (data) => {
      try {
        const { content, roomId, type, receiver, replyTo, fileUrl, fileName } = data || {};
        if ((type === "text" && (!content || !content.trim())) && !fileUrl) return;

        const msg = await Message.create({
          sender: new mongoose.Types.ObjectId(userId),
          receiver: receiver ? new mongoose.Types.ObjectId(receiver) : null,
          roomId: roomId || (receiver ? `dm:${[userId, receiver].sort().join(":")}` : "global"),
          content: content || "",
          type: type || (fileUrl ? "file" : "text"),
          fileUrl: fileUrl || null,
          fileName: fileName || null,
          replyTo: replyTo ? new mongoose.Types.ObjectId(replyTo) : null,
        });

        const payload = await safeMessagePayload(msg);

        if (receiver) {
          io.to(receiver.toString()).emit("receiveMessage", payload);
          socket.emit("receiveMessage", payload);
        } else {
          io.to(payload.roomId).emit("receiveMessage", payload);
        }

        const recipients = await computeRecipientsForMessage(payload);
        if (recipients.length > 0) {
          await Message.findByIdAndUpdate(msg._id, {
            $addToSet: { deliveredTo: { $each: recipients.map(id => new mongoose.Types.ObjectId(id)) } }
          });
          const deliveredPayload = { messageId: payload._id, deliveredTo: recipients };
          recipients.forEach(id => io.to(id.toString()).emit("messageDelivered", deliveredPayload));
          io.to(userId.toString()).emit("messageDelivered", deliveredPayload);
        }
      } catch (err) {
        console.error("sendMessage error:", err.message);
      }
    });

    // BROADCAST MESSAGE
    socket.on("broadcastMessage", async (data) => {
      try {
        const { content, roomId } = data || {};
        if (!content || !content.toString().trim()) return;

        const msg = await Message.create({
          sender: new mongoose.Types.ObjectId(userId),
          roomId: roomId || "global",
          content,
          type: "broadcast",
        });

        const payload = await safeMessagePayload(msg);
        io.emit("receiveMessage", payload);

        const recipients = await computeRecipientsForMessage(payload);
        if (recipients.length) {
          await Message.findByIdAndUpdate(msg._id, {
            $addToSet: { deliveredTo: { $each: recipients.map(id => new mongoose.Types.ObjectId(id)) } }
          });
          const deliveredPayload = { messageId: payload._id, deliveredTo: recipients };
          recipients.forEach(id => io.to(id.toString()).emit("messageDelivered", deliveredPayload));
          io.to(userId.toString()).emit("messageDelivered", deliveredPayload);
        }
      } catch (err) {
        console.error("broadcastMessage error:", err.message);
      }
    });

    // TYPING
    socket.on("typing", (data) => {
      try {
        const { roomId, isTyping, receiver } = data || {};
        if (receiver) {
          io.to(receiver.toString()).emit("typing", { userId, username: socket.username, isTyping });
        } else {
          io.to(roomId || "global").emit("typing", { userId, username: socket.username, isTyping });
        }
      } catch (err) {
        console.error("typing error:", err.message);
      }
    });

    // MESSAGE DELIVERED
    socket.on("delivered", async ({ messageId }) => {
      try {
        if (!messageId) return;
        const msg = await Message.findById(messageId);
        if (!msg) return;

        if (!msg.deliveredTo.map(String).includes(userId.toString())) {
          msg.deliveredTo.push(userId);
          await msg.save();
        }

        const deliveredPayload = { messageId: msg._id.toString(), deliveredTo: msg.deliveredTo.map(String) };
        io.to(msg.sender.toString()).emit("messageDelivered", deliveredPayload);
        msg.deliveredTo.forEach(id => io.to(id.toString()).emit("messageDelivered", deliveredPayload));
      } catch (err) {
        console.error("delivered error:", err.message);
      }
    });

    // MESSAGE SEEN
    socket.on("seen", async ({ messageId }) => {
      try {
        if (!messageId) return;
        const msg = await Message.findById(messageId);
        if (!msg) return;

        if (!msg.seenBy.map(String).includes(userId.toString())) {
          msg.seenBy.push(userId);
          await msg.save();
        }

        const seenPayload = { messageId: msg._id.toString(), seenBy: msg.seenBy.map(String) };
        io.to(msg.sender.toString()).emit("messageSeen", seenPayload);
        msg.seenBy.forEach(id => io.to(id.toString()).emit("messageSeen", seenPayload));
      } catch (err) {
        console.error("seen error:", err.message);
      }
    });

    // EDIT MESSAGE
    socket.on("editMessage", async ({ messageId, content }) => {
      try {
        if (!messageId) return;
        const msg = await Message.findById(messageId);
        if (!msg || msg.sender.toString() !== userId.toString()) return;

        msg.content = content;
        msg.edited = true;
        await msg.save();

        const payload = messageToPayload(await msg.populate("sender", "username nickname avatar"));
        const recipients = await computeRecipientsForMessage(payload);

        recipients.forEach(id => io.to(id.toString()).emit("messageEdited", payload));
        io.to(userId.toString()).emit("messageEdited", payload);
      } catch (err) {
        console.error("editMessage error:", err.message);
      }
    });

    // DELETE MESSAGE
    socket.on("deleteMessage", async ({ messageId, forEveryone }) => {
      try {
        if (!messageId) return;
        const msg = await Message.findById(messageId);
        if (!msg) return;

        if (forEveryone) {
          if (msg.sender.toString() !== userId.toString()) return;
          msg.deletedForEveryone = true;
          await msg.save();

          const payload = { messageId: msg._id.toString(), forEveryone: true };
          const recipients = await computeRecipientsForMessage(messageToPayload(msg));
          recipients.forEach(id => io.to(id.toString()).emit("messageDeleted", payload));
          io.to(userId.toString()).emit("messageDeleted", payload);
        } else {
          msg.deletedFor = msg.deletedFor || [];
          if (!msg.deletedFor.map(String).includes(userId.toString())) {
            msg.deletedFor.push(userId);
            await msg.save();
          }
          socket.emit("messageDeleted", { messageId: msg._id.toString(), forEveryone: false });
        }
      } catch (err) {
        console.error("deleteMessage error:", err.message);
      }
    });

    // ADD REACTION
    socket.on("addReaction", async ({ messageId, emoji }) => {
      try {
        if (!messageId || !emoji) return;
        const msg = await Message.findById(messageId);
        if (!msg) return;

        const index = msg.reactions.findIndex(r => r.emoji === emoji && r.user.toString() === userId.toString());
        if (index === -1) {
          msg.reactions.push({ emoji, user: new mongoose.Types.ObjectId(userId) });
        } else {
          msg.reactions.splice(index, 1);
        }
        await msg.save();

        const reactionsCount = {};
        msg.reactions.forEach(r => reactionsCount[r.emoji] = (reactionsCount[r.emoji] || 0) + 1);
        const payload = { messageId: msg._id.toString(), reactions: reactionsCount };

        const recipients = await computeRecipientsForMessage(messageToPayload(msg));
        recipients.forEach(id => io.to(id.toString()).emit("reactionUpdated", payload));
        io.to(userId.toString()).emit("reactionUpdated", payload);
      } catch (err) {
        console.error("addReaction error:", err.message);
      }
    });

    // GET ROOMS
    socket.on("getRooms", async () => {
      try {
        const rooms = Array.from(io.sockets.adapter.rooms.keys()).filter(r => !io.sockets.sockets.get(r));
        socket.emit("roomsList", rooms);
      } catch (err) {
        console.error("getRooms error:", err.message);
      }
    });

    // DISCONNECT
    socket.on("disconnect", async (reason) => {
      try {
        console.log(`🔌 Socket disconnected: ${socket.id} | user=${userId} | reason=${reason}`);
        onlineUsers.delete(userId.toString());
        await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen: new Date(), socketId: null });
        emitOnlineUsers(io);
      } catch (err) {
        console.error("disconnect error:", err.message);
      }
    });
  });

  // -------------------------
  // EMIT ONLINE USERS
  // -------------------------
  const emitOnlineUsers = async (io) => {
    try {
      const users = await User.find({}, "username isOnline lastSeen").lean();
      const count = users.filter(u => u.isOnline).length;
      const usersMap = {};
      users.forEach(u => {
        const id = u._id ? u._id.toString() : String(u.id || u._id);
        usersMap[id] = { username: u.username, isOnline: !!u.isOnline, lastSeen: u.lastSeen };
      });
      io.emit("onlineUsers", { count, users: usersMap });
    } catch (err) {
      console.error("emitOnlineUsers error:", err.message);
    }
  };
};

