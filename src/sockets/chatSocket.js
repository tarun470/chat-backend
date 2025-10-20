import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Message from "../models/Message.js";

/**
 * Initialize and handle Socket.IO chat
 * @param {import("socket.io").Server} io
 */
export const handleChatSocket = (io) => {
  // ✅ Middleware: Verify JWT on every connection
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token || socket.handshake.query?.token;

      if (!token) return next(new Error("Auth error: No token provided"));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      next();
    } catch (err) {
      console.error("❌ Socket authentication failed:", err.message);
      next(new Error("Authentication error"));
    }
  });

  // ✅ Handle new connections
  io.on("connection", (socket) => {
    console.log(`✅ User connected: ${socket.id} | UserID: ${socket.userId}`);

    // ✅ Receive and broadcast messages globally
    socket.on("sendMessage", async (data) => {
      try {
        if (!data?.content || !data.content.trim()) return;

        const senderId = new mongoose.Types.ObjectId(socket.userId);

        // Save message to MongoDB
        const newMsg = await Message.create({
          sender: senderId,
          content: data.content.trim(),
        });

        const messagePayload = {
          _id: newMsg._id.toString(),
          senderId: newMsg.sender.toString(),
          content: newMsg.content,
          timestamp: newMsg.createdAt.toISOString(),
        };

        // 🔹 Global broadcast to all connected clients
        io.emit("receiveMessage", messagePayload);
        console.log(`💬 Broadcast message: ${newMsg.content}`);
      } catch (error) {
        console.error("❌ Failed to save or broadcast message:", error.message);
      }
    });

    // Optional: typing indicator
    socket.on("typing", (isTyping) => {
      socket.broadcast.emit("userTyping", {
        userId: socket.userId,
        isTyping,
      });
    });

    // Handle disconnect
    socket.on("disconnect", (reason) => {
      console.log(`🔌 User disconnected: ${socket.id} | Reason: ${reason}`);
    });
  });
};

