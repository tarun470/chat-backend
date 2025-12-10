// socket-handlers.js (Nickname Version: Fully Updated & Fixed)
import jwt from "jsonwebtoken";
import crypto from "crypto";
import Message from "../models/Message.js";
import User from "../models/User.js";

const onlineUsers = new Map(); // { userId: { socketId, nickname, avatar } }

// ============================
// Utility: Generate Secure DM Room ID
// ============================
const getDMRoom = (id1, id2) => {
  const sorted = [id1.toString(), id2.toString()].sort().join("|");
  return "dm:" + crypto.createHash("sha256").update(sorted).digest("hex").slice(0, 20);
};

// ============================
// Rate Limiting
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

  // AUTH
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error("No token provided"));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select("nickname avatar");
      if (!user) return next(new Error("User not found"));

      socket.userId = user._id.toString();
      socket.userData = user;

      next();
    } catch (err) {
      console.error("Socket Auth Error:", err.message);
      next(new Error("Authentication Error"));
    }
  });

  // CONNECTION
  io.on("connection", async (socket) => {
    const userId = socket.userId;

    console.log(`🔵 Connected: ${userId} | socket ${socket.id}`);

    onlineUsers.set(userId, {
      socketId: socket.id,
      nickname: socket.userData.nickname,
      avatar: socket.userData.avatar,
    });

    socket.join(userId);
    socket.join("global");

    User.findByIdAndUpdate(userId, {
      isOnline: true,
      socketId: socket.id,
      lastSeen: new Date(),
    }).catch(() => {});

    emitOnlineUsers(io);

    // ============================
    // FIXED buildPayload() for Flutter
    // ============================
    const buildPayload = (m) => {
      if (!m) return null;

      const reactionMap = {};
      (m.reactions || []).forEach((x) => {
        reactionMap[x.emoji] = (reactionMap[x.emoji] || 0) + 1;
      });

      return {
        _id: m._id.toString(),

        // FLAT FIELDS (Flutter requirement)
        senderId: m.sender?._id?.toString() ?? "",
        senderName: m.sender?.nickname ?? "Unknown",
        senderAvatar: m.sender?.avatar ?? null,

        content: m.content,
        type: m.type,
        fileUrl: m.fileUrl || null,
        fileName: m.fileName || null,
        roomId: m.roomId,

        replyTo: m.replyTo?._id?.toString() ?? null,

        // ALWAYS ISO STRING (Flutter requirement)
        createdAt: new Date(m.createdAt).toISOString(),
        updatedAt: new Date(m.updatedAt || m.createdAt).toISOString(),

        deliveredTo: (m.deliveredTo || []).map((id) => id.toString()),
        seenBy: (m.seenBy || []).map((id) => id.toString()),

        reactions: reactionMap,
        edited: !!m.edited,
        deletedForEveryone: m.deletedForEveryone ?? false,
      };
    };

    const fetchMsg = async (id) =>
      Message.findById(id)
        .populate("sender", "nickname avatar")
        .populate({
          path: "replyTo",
          populate: { path: "sender", select: "nickname avatar" },
        })
        .lean();

    // ============================
    // SEND MESSAGE
    // ============================
    socket.on("sendMessage", async (data = {}) => {
      if (!rateLimit(socket, "sendMessage", 150)) return;

      try {
        const { content, roomId, receiver, type, replyTo, fileUrl, fileName } = data;

        if ((!content || !content.trim()) && !fileUrl) return;

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

        if (receiver) {
          io.to(receiver.toString()).emit("receiveMessage", payload);
          io.to(userId).emit("receiveMessage", payload);
        } else {
          io.to(finalRoom).emit("receiveMessage", payload);
        }
      } catch (err) {
        console.error("sendMessage:", err.message);
      }
    });

    // SEEN
    socket.on("seen", async ({ messageId }) => {
      if (!rateLimit(socket, "seen", 80)) return;

      try {
        const msg = await Message.findById(messageId);
        if (!msg) return;

        if (!msg.seenBy.includes(userId)) {
          msg.seenBy.push(userId);
          await msg.save();
        }

        io.to(msg.sender.toString()).emit("messageSeen", {
          messageId,
          seenBy: msg.seenBy.map(String),
        });
      } catch (err) {
        console.error("seen:", err.message);
      }
    });

    // EDIT
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

        io.to(msg.roomId).emit("messageEdited", payload);
      } catch (err) {
        console.error("editMessage:", err.message);
      }
    });

    // TYPING
    socket.on("typing", ({ roomId, isTyping, receiver }) => {
      if (!rateLimit(socket, "typing", 80)) return;

      const payload = {
        userId,
        username: socket.userData.nickname,
        isTyping: !!isTyping,
      };

      if (receiver) io.to(receiver).emit("typing", payload);
      else io.to(roomId || "global").emit("typing", payload);
    });

    // DISCONNECT
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

  // ONLINE USERS + LAST SEEN
  const emitOnlineUsers = (io) => {
    const usersObj = {};
    const lastSeen = { users: {} };
    const now = new Date().toISOString();

    for (const [uid, data] of onlineUsers.entries()) {
      usersObj[uid] = {
        username: data.nickname,
        nickname: data.nickname,
        avatar: data.avatar,
        isOnline: true,
      };

      lastSeen.users[uid] = { lastSeen: now };
    }

    io.emit("onlineUsers", { count: onlineUsers.size, users: usersObj });
    io.emit("lastSeen", lastSeen);
  };
};
