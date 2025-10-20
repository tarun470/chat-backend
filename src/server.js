import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import app from "./app.js";
import { handleChatSocket } from "./sockets/chatSocket.js";

// ✅ Load environment variables
dotenv.config();

// ✅ Connect to MongoDB
connectDB();

// ✅ Create HTTP server
const server = http.createServer(app);

// ✅ Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "*", // frontend URL
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// ✅ Socket handlers
handleChatSocket(io);

// ✅ Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Socket.IO active and listening...`);
});

