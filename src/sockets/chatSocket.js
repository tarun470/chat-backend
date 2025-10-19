import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Message from "../models/Message.js";

export const handleChatSocket = (io) => {
  // ✅ Socket.io middleware: verify JWT per connection
  io.use((socket, next) => {
    try {
      // Handle both query and auth payloads for flexibility
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error("Auth error: No token provided"));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id; // attach verified user ID to socket
      next();
    } catch (err) {
      console.error("❌ Socket authentication failed:", err.message);
      next(new Error("Authentication error"));
    }
  });

  // ✅ Handle socket connection
  io.on("connection", (socket) => {
    console.log(`✅ User connected: ${socket.id} | UserID: ${socket.userId}`);

    // 🟢 Handle chat messages
    socket.on("sendMessage", async (data) => {
      try {
        if (!data?.content || !data.content.trim()) return;

        const senderId = new mongoose.Types.ObjectId(socket.userId);

        // Save message to MongoDB
        const newMsg = await Message.create({
          sender: senderId,
          content: data.content,
        });

        const messagePayload = {
          id: newMsg._id.toString(),
          senderId: newMsg.sender.toString(),
          content: newMsg.content,
          timestamp: newMsg.createdAt,
        };

        // ✅ Broadcast to ALL connected users (including sender)
        io.emit("receiveMessage", messagePayload);

        console.log(`💬 Broadcast message from ${socket.userId}: ${newMsg.content}`);
      } catch (error) {
        console.error("❌ Failed to save or broadcast message:", error.message);
      }
    });

    // 🟣 Optional: typing indicator support
    socket.on("typing", (isTyping) => {
      socket.broadcast.emit("userTyping", {
        userId: socket.userId,
        isTyping,
      });
    });

    // 🔴 Handle disconnect
    socket.on("disconnect", (reason) => {
      console.log(`🔌 User disconnected: ${socket.id} | Reason: ${reason}`);
    });
  });
};


