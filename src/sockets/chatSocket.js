import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Message from "../models/Message.js";

export const handleChatSocket = (io) => {
  // Middleware: verify JWT for each connection
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

  io.on("connection", (socket) => {
    console.log(`✅ User connected: ${socket.id} | UserID: ${socket.userId}`);

    // Join a chat room (optional)
    socket.on("joinRoom", (roomId) => {
      socket.join(roomId);
      console.log(`📥 User ${socket.userId} joined room: ${roomId}`);
    });

    // Receive and broadcast messages
    socket.on("sendMessage", async (data) => {
      try {
        if (!data?.content || !data.content.trim()) return;

        const senderId = new mongoose.Types.ObjectId(socket.userId);

        // Save message to MongoDB
        const newMsg = await Message.create({
          sender: senderId,
          content: data.content.trim(),
          room: data.roomId || null, // store roomId if any
        });

        const messagePayload = {
          _id: newMsg._id.toString(),
          senderId: newMsg.sender.toString(),
          content: newMsg.content,
          timestamp: newMsg.createdAt.toISOString(),
          roomId: data.roomId || null,
        };

        // Broadcast to everyone in the room (or all if no room)
        if (data.roomId) {
          io.to(data.roomId).emit("receiveMessage", messagePayload);
          console.log(`💬 Room ${data.roomId}: ${newMsg.content}`);
        } else {
          io.emit("receiveMessage", messagePayload);
          console.log(`💬 Broadcast message: ${newMsg.content}`);
        }
      } catch (error) {
        console.error("❌ Failed to save or broadcast message:", error.message);
      }
    });

    // Typing indicator
    socket.on("typing", (data) => {
      if (data.roomId) {
        socket.to(data.roomId).emit("userTyping", {
          userId: socket.userId,
          isTyping: data.isTyping,
        });
      } else {
        socket.broadcast.emit("userTyping", {
          userId: socket.userId,
          isTyping: data.isTyping,
        });
      }
    });

    // Disconnect
    socket.on("disconnect", (reason) => {
      console.log(`🔌 User disconnected: ${socket.id} | Reason: ${reason}`);
    });
  });
};
