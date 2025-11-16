import jwt from "jsonwebtoken";
import Message from "../models/Message.js";
import User from "../models/User.js";
import mongoose from "mongoose";

const onlineUsers = new Map(); // userId -> { socketId, username, lastSeen, isOnline }

export const handleChatSocket = (io) => {
  // socket auth middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error("Auth error: No token"));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      // optional attach username from DB
      const u = await User.findById(decoded.id).select("username");
      socket.username = u ? u.username : "Unknown";
      next();
    } catch (err) {
      console.error("Socket auth error:", err.message);
      next(new Error("Authentication error"));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.userId;
    console.log(`Socket connected: ${socket.id} user=${userId}`);

    // register online
    onlineUsers.set(userId.toString(), { socketId: socket.id, username: socket.username, isOnline: true, lastSeen: null });

    // join personal room for private messages
    socket.join(userId.toString());

    // also join global room
    socket.join("global");

    // update DB: mark user online
    try {
      await User.findByIdAndUpdate(userId, { isOnline: true, socketId: socket.id }, { new: true });
    } catch (e) { /* ignore */ }

    // broadcast updated online list (simple summary)
    emitOnlineUsers(io);

    // ---------- events ----------
    // sendMessage: { content, roomId, type, tempId, receiver, replyTo, fileUrl, fileName }
    socket.on("sendMessage", async (data) => {
      try {
        const { content, roomId, type, tempId, receiver, replyTo, fileUrl, fileName } = data || {};
        if ((type === "text" && (!content || !content.trim())) && !fileUrl) return;

        const doc = await Message.create({
          sender: mongoose.Types.ObjectId(userId),
          receiver: receiver ? mongoose.Types.ObjectId(receiver) : null,
          roomId: roomId || (receiver ? `dm:${[userId, receiver].sort().join(":")}` : "global"),
          content: content || "",
          type: type || (fileUrl ? "file" : "text"),
          fileUrl: fileUrl || null,
          fileName: fileName || null,
          replyTo: replyTo || null,
        });

        // prepare outgoing payload
        const populated = await Message.findById(doc._id).populate("sender", "username nickname avatar");
        const payload = messageToPayload(populated);

        // Emit: to room or to receiver specifically
        if (receiver) {
          // private: send to sender and receiver rooms
          io.to(receiver.toString()).emit("receiveMessage", payload);
          socket.emit("receiveMessage", payload);
        } else {
          // room message (global/roomId)
          io.to(payload.roomId).emit("receiveMessage", payload);
        }

        // Optionally mark delivered for online users in the room
        // We'll update deliveredTo for recipients that are online now (simple)
        const recipients = await computeRecipientsForMessage(payload, io);
        if (recipients.length > 0) {
          await Message.findByIdAndUpdate(doc._id, { $addToSet: { deliveredTo: { $each: recipients.map(id => mongoose.Types.ObjectId(id)) } } });
          // emit delivered event to sender and recipients
          io.to(payload.roomId).emit("messageDelivered", { messageId: payload._id, deliveredTo: recipients });
        }
      } catch (err) {
        console.error("sendMessage error:", err);
      }
    });

    // typing: { roomId, isTyping, receiver (optional) }
    socket.on("typing", (data) => {
      try {
        const { roomId, isTyping, receiver } = data || {};
        if (receiver) {
          // private typing: notify receiver only
          io.to(receiver.toString()).emit("typing", { userId, username: socket.username, isTyping });
        } else {
          // room typing
          io.to(roomId || "global").emit("typing", { userId, username: socket.username, isTyping });
        }
      } catch (err) { /* ignore */ }
    });

    // mark delivered by client (client acknowledges they received) { messageId }
    socket.on("delivered", async (data) => {
      try {
        const { messageId } = data || {};
        if (!messageId) return;
        const msg = await Message.findById(messageId);
        if (!msg) return;
        // add user to deliveredTo
        if (!msg.deliveredTo.map(String).includes(userId.toString())) {
          msg.deliveredTo.push(userId);
          await msg.save();
        }
        // emit update
        io.to(msg.roomId).emit("messageDelivered", { messageId: msg._id.toString(), deliveredTo: msg.deliveredTo.map(String) });
      } catch (err) { console.error("delivered error:", err.message); }
    });

    // mark seen/read { messageId }
    socket.on("seen", async (data) => {
      try {
        const { messageId } = data || {};
        if (!messageId) return;
        const msg = await Message.findById(messageId);
        if (!msg) return;
        if (!msg.seenBy.map(String).includes(userId.toString())) {
          msg.seenBy.push(userId);
          await msg.save();
        }
        // emit to room and sender about seen
        io.to(msg.roomId).emit("messageSeen", { messageId: msg._id.toString(), seenBy: msg.seenBy.map(String) });
      } catch (err) { console.error("seen error:", err.message); }
    });

    // editMessage { messageId, content }
    socket.on("editMessage", async (data) => {
      try {
        const { messageId, content } = data || {};
        if (!messageId) return;
        const msg = await Message.findById(messageId);
        if (!msg) return;
        if (msg.sender.toString() !== userId.toString()) return; // only sender
        msg.content = content;
        msg.edited = true;
        await msg.save();
        const payload = messageToPayload(await msg.populate("sender", "username nickname avatar"));
        io.to(msg.roomId).emit("messageEdited", payload);
      } catch (err) { console.error("editMessage error:", err.message); }
    });

    // deleteMessage { messageId, forEveryone }
    socket.on("deleteMessage", async (data) => {
      try {
        const { messageId, forEveryone } = data || {};
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
      } catch (err) { console.error("deleteMessage error:", err.message); }
    });

    // addReaction { messageId, emoji }
    socket.on("addReaction", async (data) => {
      try {
        const { messageId, emoji } = data || {};
        if (!messageId || !emoji) return;
        const msg = await Message.findById(messageId);
        if (!msg) return;
        // ensure unique per user per emoji (toggle behavior)
        const existsIndex = msg.reactions.findIndex(r => r.emoji === emoji && r.user.toString() === userId.toString());
        if (existsIndex === -1) {
          msg.reactions.push({ emoji, user: mongoose.Types.ObjectId(userId) });
        } else {
          // if already exists, remove (toggle)
          msg.reactions.splice(existsIndex, 1);
        }
        await msg.save();

        // compute counts
        const counts = {};
        msg.reactions.forEach(r => counts[r.emoji] = (counts[r.emoji] || 0) + 1);

        io.to(msg.roomId).emit("reactionUpdated", { messageId: msg._id.toString(), reactions: counts });
      } catch (err) { console.error("addReaction error:", err.message); }
    });

    // request rooms list
    socket.on("getRooms", async () => {
      // simple rooms list: return active rooms from server (not persistent)
      const rooms = Array.from(io.sockets.adapter.rooms.keys()).filter(r => !io.sockets.sockets.get(r));
      socket.emit("roomsList", rooms);
    });

    // ---------- disconnect ----------
    socket.on("disconnect", async (reason) => {
      console.log(`Socket disconnect: ${socket.id} user=${userId} reason=${reason}`);
      onlineUsers.delete(userId.toString());
      try {
        await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen: new Date(), socketId: null });
      } catch (e) { /* ignore */ }
      emitOnlineUsers(io);
    });
  });

  // helper: emit online users summary
  const emitOnlineUsers = async (io) => {
    // produce list from DB for accuracy
    try {
      const users = await User.find({}, "username isOnline lastSeen").lean();
      const count = users.filter(u => u.isOnline).length;
      // map userId -> { username, isOnline, lastSeen }
      const usersMap = {};
      users.forEach(u => { usersMap[u._id] = { username: u.username, isOnline: !!u.isOnline, lastSeen: u.lastSeen }; });
      io.emit("onlineUsers", { count, users: usersMap });
    } catch (err) {
      console.error("emitOnlineUsers error:", err.message);
    }
  };

  // helper: prepare payload
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

  // helper: compute recipients that are online for a message
  const computeRecipientsForMessage = async (payload, io) => {
    try {
      if (payload.roomId && payload.roomId !== "global") {
        // for simplicity, if roomId starts with 'dm:' parse participants
        if (payload.roomId.startsWith("dm:")) {
          const parts = payload.roomId.split(":")[1].split(":");
          return parts.filter(p => p !== payload.sender?._id).map(String);
        }
        // else broadcast to all sockets in the room except sender
        const sockets = await io.in(payload.roomId).fetchSockets();
        return sockets.map(s => s.userId).filter(Boolean).filter(id => id !== payload.sender?._id);
      } else {
        // global: all connected user ids except sender
        const sockets = await io.fetchSockets();
        return sockets.map(s => s.userId).filter(Boolean).filter(id => id !== payload.sender?._id);
      }
    } catch (err) {
      console.error("computeRecipientsForMessage error:", err);
      return [];
    }
  };
};
