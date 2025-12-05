// socket-handlers.js
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Message from "../models/Message.js";
import User from "../models/User.js";

const onlineUsers = new Map(); // userId -> { socketId, username, isOnline, lastSeen }

/**
 * Initialize Socket.IO Chat
 * @param {import("socket.io").Server} io
 */
export const handleChatSocket = (io) => {
  // -------------------------
  // AUTH MIDDLEWARE
  // -------------------------
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token || socket.handshake.query?.token;

      if (!token) return next(new Error("No token provided"));

      if (!process.env.JWT_SECRET) {
        console.error("❌ JWT_SECRET not set");
        return next(new Error("Server misconfigured"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded?.id) return next(new Error("Invalid token payload"));

      const user = await User.findById(decoded.id).select(
        "username nickname avatar"
      );
      if (!user) return next(new Error("User not found"));

      socket.userId = user._id.toString();
      socket.username = user.username;
      socket.nickname = user.nickname;
      socket.avatar = user.avatar || null;

      next();
    } catch (err) {
      console.error("Socket auth error:", err.message);
      next(new Error("Authentication error"));
    }
  });

  // -------------------------
  // CONNECTION HANDLER
  // -------------------------
  io.on("connection", async (socket) => {
    const userId = socket.userId;
    if (!userId) {
      console.warn("Socket connected without userId");
      socket.disconnect(true);
      return;
    }

    console.log(`✅ Socket connected: ${socket.id} | user=${userId}`);

    // Put into memory map
    onlineUsers.set(userId, {
      socketId: socket.id,
      username: socket.username,
      nickname: socket.nickname,
      isOnline: true,
      lastSeen: null,
    });

    // Join personal room & default global
    socket.join(userId);
    socket.join("global");

    // Mark user online in DB
    try {
      await User.findByIdAndUpdate(
        userId,
        { isOnline: true, socketId: socket.id, lastSeen: new Date() },
        { new: true }
      );
    } catch (e) {
      console.warn("Warning updating user isOnline/socketId:", e.message);
    }

    await emitOnlineUsers(io);

    // =========================
    // HELPERS
    // =========================

    const toObjectId = (id) =>
      typeof id === "string" ? new mongoose.Types.ObjectId(id) : id;

    const buildMessagePayload = (msgDoc) => {
      if (!msgDoc) return null;

      const reactionsCount = {};
      (msgDoc.reactions || []).forEach((r) => {
        reactionsCount[r.emoji] = (reactionsCount[r.emoji] || 0) + 1;
      });

      return {
        _id: msgDoc._id.toString(),
        sender: msgDoc.sender
          ? {
              _id: msgDoc.sender._id.toString(),
              username: msgDoc.sender.username,
              nickname: msgDoc.sender.nickname,
              avatar: msgDoc.sender.avatar || null,
            }
          : null,
        content: msgDoc.content,
        type: msgDoc.type,
        fileUrl: msgDoc.fileUrl,
        fileName: msgDoc.fileName,
        roomId: msgDoc.roomId,
        replyTo:
          msgDoc.replyTo && msgDoc.replyTo._id
            ? msgDoc.replyTo._id.toString()
            : msgDoc.replyTo || null,
        createdAt: msgDoc.createdAt,
        updatedAt: msgDoc.updatedAt,
        deliveredTo: (msgDoc.deliveredTo || []).map((id) => id.toString()),
        seenBy: (msgDoc.seenBy || []).map((id) => id.toString()),
        edited: !!msgDoc.edited,
        reactions: reactionsCount,
        deletedForEveryone: !!msgDoc.deletedForEveryone,
      };
    };

    const fetchAndFormatMessage = async (id) => {
      const doc = await Message.findById(id)
        .populate("sender", "username nickname avatar")
        .populate({
          path: "replyTo",
          populate: { path: "sender", select: "username nickname avatar" },
        });
      return buildMessagePayload(doc);
    };

    const computeRecipientsForMessage = async (payload) => {
      try {
        if (!payload) return [];

        const senderId =
          payload.sender && payload.sender._id
            ? payload.sender._id.toString()
            : userId;

        // DM room: dm:<userA>:<userB>
        if (payload.roomId?.startsWith("dm:")) {
          const parts = payload.roomId.split(":").slice(1);
          return parts.filter((id) => id && id !== senderId);
        }

        // Specific room (group or global)
        const room = payload.roomId || "global";
        const sockets = await io.in(room).fetchSockets();
        const ids = sockets
          .map((s) => s.userId)
          .filter(Boolean)
          .map(String)
          .filter((id) => id !== senderId);

        return Array.from(new Set(ids));
      } catch (err) {
        console.error("computeRecipientsForMessage error:", err.message);
        return [];
      }
    };

    const markDeliveredForRecipients = async (messageId, recipients) => {
      try {
        if (!messageId || !recipients || !recipients.length) return;

        await Message.findByIdAndUpdate(messageId, {
          $addToSet: {
            deliveredTo: {
              $each: recipients.map((id) => toObjectId(id)),
            },
          },
        });

        const payload = {
          messageId: messageId.toString(),
          deliveredTo: recipients.map(String),
        };

        recipients.forEach((uid) => io.to(uid).emit("messageDelivered", payload));
        io.to(userId).emit("messageDelivered", payload);
      } catch (err) {
        console.error("markDeliveredForRecipients error:", err.message);
      }
    };

    const markSeenForUser = async (messageId, uid) => {
      try {
        if (!messageId || !uid) return;
        const msg = await Message.findById(messageId);
        if (!msg) return;

        const userStr = uid.toString();
        if (!msg.seenBy.map(String).includes(userStr)) {
          msg.seenBy.push(toObjectId(uid));
          await msg.save();
        }

        const payload = {
          messageId: msg._id.toString(),
          seenBy: msg.seenBy.map((id) => id.toString()),
        };

        io.to(msg.sender.toString()).emit("messageSeen", payload);
        msg.seenBy.forEach((id) => io.to(id.toString()).emit("messageSeen", payload));
      } catch (err) {
        console.error("markSeenForUser error:", err.message);
      }
    };

    // =========================
    // EVENTS
    // =========================

    // SEND MESSAGE
    socket.on("sendMessage", async (data = {}) => {
      try {
        const {
          content,
          roomId,
          type,
          receiver,
          replyTo,
          fileUrl,
          fileName,
          tempId,
        } = data;

        if (
          (!content || !content.toString().trim()) &&
          !fileUrl &&
          type !== "system"
        ) {
          return;
        }

        let finalRoomId = roomId || "global";

        // Direct message room
        if (receiver && !roomId) {
          const a = userId.toString();
          const b = receiver.toString();
          const ordered = [a, b].sort();
          finalRoomId = `dm:${ordered[0]}:${ordered[1]}`;
        }

        const msg = await Message.create({
          sender: toObjectId(userId),
          receiver: receiver ? toObjectId(receiver) : null,
          roomId: finalRoomId,
          content: content || "",
          type: type || (fileUrl ? "file" : "text"),
          fileUrl: fileUrl || null,
          fileName: fileName || null,
          replyTo: replyTo ? toObjectId(replyTo) : null,
        });

        const payload = await fetchAndFormatMessage(msg._id);
        if (!payload) return;

        // Emit message
        if (receiver) {
          io.to(receiver.toString()).emit("receiveMessage", payload);
          socket.emit("receiveMessage", payload);
        } else {
          io.to(finalRoomId).emit("receiveMessage", payload);
        }

        // Compute recipients & mark delivered
        const recipients = await computeRecipientsForMessage(payload);
        if (recipients.length) {
          await markDeliveredForRecipients(msg._id, recipients);
        }
      } catch (err) {
        console.error("sendMessage error:", err.message);
      }
    });

    // BROADCAST MESSAGE (system / global)
    socket.on("broadcastMessage", async (data = {}) => {
      try {
        const { content, roomId } = data;
        if (!content || !content.toString().trim()) return;

        const msg = await Message.create({
          sender: toObjectId(userId),
          roomId: roomId || "global",
          content,
          type: "system",
        });

        const payload = await fetchAndFormatMessage(msg._id);
        if (!payload) return;

        io.to(payload.roomId).emit("receiveMessage", payload);

        const recipients = await computeRecipientsForMessage(payload);
        if (recipients.length) {
          await markDeliveredForRecipients(msg._id, recipients);
        }
      } catch (err) {
        console.error("broadcastMessage error:", err.message);
      }
    });

    // TYPING
    socket.on("typing", (data = {}) => {
      try {
        const { roomId, isTyping, receiver } = data;

        const payload = {
          userId,
          username: socket.username,
          isTyping: !!isTyping,
        };

        if (receiver) {
          io.to(receiver.toString()).emit("typing", payload);
        } else {
          io.to(roomId || "global").emit("typing", payload);
        }
      } catch (err) {
        console.error("typing error:", err.message);
      }
    });

    // DELIVERED (client ACK)
    socket.on("delivered", async ({ messageId } = {}) => {
      try {
        if (!messageId) return;
        const msg = await Message.findById(messageId);
        if (!msg) return;

        const me = userId.toString();
        if (!msg.deliveredTo.map(String).includes(me)) {
          msg.deliveredTo.push(toObjectId(userId));
          await msg.save();
        }

        const payload = {
          messageId: msg._id.toString(),
          deliveredTo: msg.deliveredTo.map((id) => id.toString()),
        };

        io.to(msg.sender.toString()).emit("messageDelivered", payload);
        msg.deliveredTo.forEach((id) =>
          io.to(id.toString()).emit("messageDelivered", payload)
        );
      } catch (err) {
        console.error("delivered error:", err.message);
      }
    });

    // SEEN (client ACK)
    socket.on("seen", async ({ messageId } = {}) => {
      try {
        if (!messageId) return;
        await markSeenForUser(messageId, userId);
      } catch (err) {
        console.error("seen error:", err.message);
      }
    });

    // EDIT MESSAGE
    socket.on("editMessage", async ({ messageId, content } = {}) => {
      try {
        if (!messageId || !content?.toString().trim()) return;

        const msg = await Message.findById(messageId);
        if (!msg) return;
        if (msg.sender.toString() !== userId.toString()) return;

        msg.content = content;
        msg.edited = true;
        await msg.save();

        const populated = await Message.findById(messageId).populate(
          "sender",
          "username nickname avatar"
        );
        const payload = buildMessagePayload(populated);
        if (!payload) return;

        const recipients = await computeRecipientsForMessage(payload);
        recipients.forEach((id) =>
          io.to(id.toString()).emit("messageEdited", payload)
        );
        io.to(userId).emit("messageEdited", payload);
      } catch (err) {
        console.error("editMessage error:", err.message);
      }
    });

    // DELETE MESSAGE
    socket.on("deleteMessage", async ({ messageId, forEveryone } = {}) => {
      try {
        if (!messageId) return;
        const msg = await Message.findById(messageId);
        if (!msg) return;

        const isSender = msg.sender.toString() === userId.toString();

        if (forEveryone) {
          if (!isSender) return;
          msg.deletedForEveryone = true;
          await msg.save();

          const tmpPayload = buildMessagePayload(msg);
          const recipients = await computeRecipientsForMessage(tmpPayload);

          const payload = {
            messageId: msg._id.toString(),
            forEveryone: true,
          };

          recipients.forEach((id) =>
            io.to(id.toString()).emit("messageDeleted", payload)
          );
          io.to(userId).emit("messageDeleted", payload);
        } else {
          msg.deletedFor = msg.deletedFor || [];
          const me = userId.toString();
          if (!msg.deletedFor.map(String).includes(me)) {
            msg.deletedFor.push(toObjectId(userId));
            await msg.save();
          }

          socket.emit("messageDeleted", {
            messageId: msg._id.toString(),
            forEveryone: false,
          });
        }
      } catch (err) {
        console.error("deleteMessage error:", err.message);
      }
    });

    // ADD / REMOVE REACTION (TOGGLE)
    socket.on("addReaction", async ({ messageId, emoji } = {}) => {
      try {
        if (!messageId || !emoji) return;

        const msg = await Message.findById(messageId);
        if (!msg) return;

        msg.reactions = msg.reactions || [];

        const idx = msg.reactions.findIndex(
          (r) =>
            r.emoji === emoji && r.user.toString() === userId.toString()
        );

        if (idx === -1) {
          msg.reactions.push({ emoji, user: toObjectId(userId) });
        } else {
          msg.reactions.splice(idx, 1);
        }

        await msg.save();

        const reactionsCount = {};
        msg.reactions.forEach((r) => {
          reactionsCount[r.emoji] = (reactionsCount[r.emoji] || 0) + 1;
        });

        const tmpPayload = buildMessagePayload(msg);
        const recipients = await computeRecipientsForMessage(tmpPayload);

        const payload = {
          messageId: msg._id.toString(),
          reactions: reactionsCount,
        };

        recipients.forEach((id) =>
          io.to(id.toString()).emit("reactionUpdated", payload)
        );
        io.to(userId).emit("reactionUpdated", payload);
      } catch (err) {
        console.error("addReaction error:", err.message);
      }
    });

    // GET ROOMS (for debugging / UI lists)
    socket.on("getRooms", async () => {
      try {
        const roomsRaw = Array.from(io.sockets.adapter.rooms.entries());
        const rooms = roomsRaw
          .filter(([name, set]) => !io.sockets.sockets.get(name))
          .map(([name]) => name);

        socket.emit("roomsList", rooms);
      } catch (err) {
        console.error("getRooms error:", err.message);
      }
    });

    // DISCONNECT
    socket.on("disconnect", async (reason) => {
      try {
        console.log(
          `🔌 Socket disconnected: ${socket.id} | user=${userId} | reason=${reason}`
        );

        onlineUsers.delete(userId);

        await User.findByIdAndUpdate(userId, {
          isOnline: false,
          lastSeen: new Date(),
          socketId: null,
        });

        await emitOnlineUsers(io);
      } catch (err) {
        console.error("disconnect error:", err.message);
      }
    });
  });

  // =========================
  // ONLINE USERS EMITTER
  // =========================
  const emitOnlineUsers = async (ioInstance) => {
    try {
      const users = await User.find({}, "username nickname isOnline lastSeen").lean();
      const count = users.filter((u) => u.isOnline).length;

      const usersMap = {};
      users.forEach((u) => {
        const id = u._id.toString();
        usersMap[id] = {
          username: u.username,
          nickname: u.nickname,
          isOnline: !!u.isOnline,
          lastSeen: u.lastSeen,
        };
      });

      ioInstance.emit("onlineUsers", { count, users: usersMap });
    } catch (err) {
      console.error("emitOnlineUsers error:", err.message);
    }
  };
};
