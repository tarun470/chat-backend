import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Message from "../models/Message.js";

export const handleChatSocket = (io) => {
  // ✅ Middleware to verify JWT per socket connection
  io.use((socket, next) => {
    try {
      const token = socket.handshake.query.token;
      if (!token) return next(new Error("Auth error: No token provided"));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id; // attach userId to socket
      next();
    } catch (err) {
      console.error("❌ Socket auth error:", err.message);
      next(new Error("Auth error: Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    console.log("✅ User connected:", socket.id, "| UserID:", socket.userId);

    // 🟢 Handle incoming message
    socket.on("sendMessage", async (data) => {
      try {
        if (!data?.content?.trim()) return;

        const senderId = new mongoose.Types.ObjectId(socket.userId);

        // Save to DB
        const newMsg = await Message.create({
          sender: senderId,
          content: data.content,
        });

        // Prepare message data
        const messageData = {
          id: newMsg._id.toString(),
          senderId: newMsg.sender.toString(),
          content: newMsg.content,
          timestamp: newMsg.createdAt,
        };

        // ✅ Broadcast to *all* connected clients (including sender)
        io.emit("receiveMessage", messageData);

        console.log("💬 Broadcasted message:", messageData.content);
      } catch (err) {
        console.error("❌ Error saving or broadcasting message:", err.message);
      }
    });

    socket.on("disconnect", () => {
      console.log("🔌 User disconnected:", socket.id);
    });
  });
};


