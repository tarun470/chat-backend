// socket-handlers.js (paste / replace your previous handleChatSocket implementation)
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
    // HELPERS (local to connection)
    // -------------------------
    const safeMessagePayload = async (msgDoc) => {
      const populated = await Message.findById(msgDoc._id).populate("sender", "username nickname avatar");
      return messageToPayload(populated);
    };

    // -------------------------
    // EVENTS
    // -------------------------

    // sendMessage (text/image/file/reply/broadcast saved as type accordingly)
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

        // build payload
        const payload = await safeMessagePayload(msg);

        // deliver message: DM vs room
        if (receiver) {
          // direct send: receiver + sender
          io.to(receiver.toString()).emit("receiveMessage", payload);
          socket.emit("receiveMessage", payload);
        } else {
          // room/global - emit to room channel (clients listening to room IDs should subscribe)
          // but many clients may not join room channels; also emit to everyone in room via personal rooms of recipients
          io.to(payload.roomId).emit("receiveMessage", payload);
        }

        // compute recipients and emit delivered notifications to each recipient and sender
        const recipients = await computeRecipientsForMessage(payload, io);
        if (recipients.length > 0) {
          // persist deliveredTo (add unique recipients)
          await Message.findByIdAndUpdate(msg._id, {
            $addToSet: { deliveredTo: { $each: recipients.map(id => mongoose.Types.ObjectId(id)) } }
          });

          // notify each recipient and the sender
          const deliveredPayload = { messageId: payload._id, deliveredTo: recipients };
          recipients.forEach(id => {
            io.to(id.toString()).emit("messageDelivered", deliveredPayload);
          });
          // also notify sender (so sender UI updates)
          io.to(userId.toString()).emit("messageDelivered", deliveredPayload);
        }
      } catch (err) {
        console.error("sendMessage error:", err.message);
      }
    });

    // -------------------------
    // broadcastMessage (admin / announcements)
    // -------------------------
    socket.on("broadcastMessage", async (data) => {
      try {
        const { content, senderName, roomId } = data || {};
        if (!content || !content.toString().trim()) return;

        // persist broadcast as message type = 'broadcast' (ensure your Message schema accepts this type)
        const msg = await Message.create({
          sender: mongoose.Types.ObjectId(userId),
          roomId: roomId || "global",
          content,
          type: "broadcast",
        });

        const payload = await safeMessagePayload(msg);

        // emit as a normal received message so frontends reuse same flow
        io.emit("receiveMessage", payload);

        // compute recipients (everyone except sender) and mark delivered
        const recipients = await computeRecipientsForMessage(payload, io);
        if (recipients.length) {
          await Message.findByIdAndUpdate(msg._id, {
            $addToSet: { deliveredTo: { $each: recipients.map(id => mongoose.Types.ObjectId(id)) } }
          });
          const deliveredPayload = { messageId: payload._id, deliveredTo: recipients };
          recipients.forEach(id => io.to(id.toString()).emit("messageDelivered", deliveredPayload));
          io.to(userId.toString()).emit("messageDelivered", deliveredPayload);
        }
      } catch (err) {
        console.error("broadcastMessage error:", err.message);
      }
    });

    // -------------------------
    // typing
    // -------------------------
    socket.on("typing", (data) => {
      const { roomId, isTyping, receiver } = data || {};
      if (receiver) {
        io.to(receiver.toString()).emit("typing", { userId, username: socket.username, isTyping });
      } else {
        io.to(roomId || "global").emit("typing", { userId, username: socket.username, isTyping });
      }
    });

    // -------------------------
    // delivered (client acknowledges it received the message)
    // -------------------------
    socket.on("delivered", async ({ messageId }) => {
      try {
        if (!messageId) return;
        const msg = await Message.findById(messageId);
        if (!msg) return;
        if (!msg.deliveredTo.map(String).includes(userId.toString())) {
          msg.deliveredTo.push(userId);
          await msg.save();
        }
        // notify all relevant parties (sender + recipients)
        const deliveredTo = msg.deliveredTo.map(String);
        const payload = { messageId: msg._id.toString(), deliveredTo };
        // notify sender
        io.to(msg.sender.toString()).emit("messageDelivered", payload);
        // notify all recipients individually
        deliveredTo.forEach(id => io.to(id.toString()).emit("messageDelivered", payload));
      } catch (err) {
        console.error("delivered handler error:", err.message);
      }
    });

    // -------------------------
    // seen (client marks message seen)
    // -------------------------
    socket.on("seen", async ({ messageId }) => {
      try {
        if (!messageId) return;
        const msg = await Message.findById(messageId);
        if (!msg) return;
        if (!msg.seenBy.map(String).includes(userId.toString())) {
          msg.seenBy.push(userId);
          await msg.save();
        }
        // notify sender and recipients about seen
        const seenBy = msg.seenBy.map(String);
        const payload = { messageId: msg._id.toString(), seenBy };
        io.to(msg.sender.toString()).emit("messageSeen", payload);
        seenBy.forEach(id => io.to(id.toString()).emit("messageSeen", payload));
      } catch (err) {
        console.error("seen handler error:", err.message);
      }
    });

    // -------------------------
    // editMessage
    // -------------------------
    socket.on("editMessage", async ({ messageId, content }) => {
      try {
        if (!messageId) return;
        const msg = await Message.findById(messageId);
        if (!msg || msg.sender.toString() !== userId.toString()) return;
        msg.content = content;
        msg.edited = true;
        await msg.save();
        const payload = messageToPayload(await msg.populate("sender", "username nickname avatar"));
        // notify room / recipients (use recipients list for reliability)
        const recipients = await computeRecipientsForMessage(payload, io);
        // notify each recipient and sender
        recipients.forEach(id => io.to(id.toString()).emit("messageEdited", payload));
        io.to(userId.toString()).emit("messageEdited", payload);
      } catch (err) {
        console.error("editMessage error:", err.message);
      }
    });

    // -------------------------
    // deleteMessage
    // -------------------------
    socket.on("deleteMessage", async ({ messageId, forEveryone }) => {
      try {
        if (!messageId) return;
        const msg = await Message.findById(messageId);
        if (!msg) return;
        if (forEveryone) {
          if (msg.sender.toString() !== userId.toString()) return;
          msg.deletedForEveryone = true;
          await msg.save();
          // notify all recipients and sender
          const recipients = await computeRecipientsForMessage(messageToPayload(msg), io);
          recipients.forEach(id => io.to(id.toString()).emit("messageDeleted", { messageId: msg._id.toString(), forEveryone: true }));
          io.to(userId.toString()).emit("messageDeleted", { messageId: msg._id.toString(), forEveryone: true });
        } else {
          msg.deletedFor = msg.deletedFor || [];
          if (!msg.deletedFor.map(String).includes(userId.toString())) {
            msg.deletedFor.push(userId);
            await msg.save();
          }
          // only notify the current socket (local delete)
          socket.emit("messageDeleted", { messageId: msg._id.toString(), forEveryone: false });
        }
      } catch (err) {
        console.error("deleteMessage error:", err.message);
      }
    });

    // -------------------------
    // addReaction
    // -------------------------
    socket.on("addReaction", async ({ messageId, emoji }) => {
      try {
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

        // notify recipients + sender
        const payload = { messageId: msg._id.toString(), reactions: counts };
        const recipients = await computeRecipientsForMessage(messageToPayload(msg), io);
        recipients.forEach(id => io.to(id.toString()).emit("reactionUpdated", payload));
        io.to(userId.toString()).emit("reactionUpdated", payload);
      } catch (err) {
        console.error("addReaction error:", err.message);
      }
    });

    // -------------------------
    // getRooms
    // -------------------------
    socket.on("getRooms", async () => {
      try {
        const rooms = Array.from(io.sockets.adapter.rooms.keys()).filter(r => !io.sockets.sockets.get(r));
        socket.emit("roomsList", rooms);
      } catch (err) {
        console.error("getRooms error:", err.message);
      }
    });

    // -------------------------
    // disconnect
    // -------------------------
    socket.on("disconnect", async (reason) => {
      try {
        console.log(`🔌 Socket disconnected: ${socket.id} | user=${userId} | reason=${reason}`);
        onlineUsers.delete(userId.toString());
        await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen: new Date(), socketId: null });
        emitOnlineUsers(io);
      } catch (err) {
        console.error("disconnect handler error:", err.message);
      }
    });

  }); // end io.on("connection")

  // -------------------------
  // HELPERS (shared)
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

  const computeRecipientsForMessage = async (payload, io) => {
    try {
      // room-level DM like 'dm:uid1:uid2:uid3' or group/room names
      if (payload.roomId && payload.roomId !== "global") {
        if (payload.roomId.startsWith("dm:")) {
          // get all parts after the 'dm' prefix
          const parts = payload.roomId.split(":").slice(1);
          // filter out sender id
          const senderId = payload.sender?._id || payload.sender;
          return parts.filter(p => p !== senderId).map(String);
        }
        // regular room: fetch sockets in the room and map userId
        const sockets = await io.in(payload.roomId).fetchSockets();
        return sockets.map(s => s.userId).filter(Boolean).filter(id => id !== (payload.sender?._id || payload.sender));
      } else {
        // global: everyone except sender
        const sockets = await io.fetchSockets();
        return sockets.map(s => s.userId).filter(Boolean).filter(id => id !== (payload.sender?._id || payload.sender));
      }
    } catch (err) {
      console.error("computeRecipientsForMessage error:", err);
      return [];
    }
  };
};
