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

// ✅ Create HTTP server from Express app
const server = http.createServer(app);

// ✅ Initialize Socket.IO server
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "*", // allows Flutter or web clients
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// ✅ Initialize chat socket handler
handleChatSocket(io);

// ✅ Server listen
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Socket.IO active and listening...`);
});
