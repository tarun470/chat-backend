import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import app from "./app.js";
import { handleChatSocket } from "./sockets/chatSocket.js";

dotenv.config();

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "https://flutter-frontend-1gz1.onrender.com",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Initialize chat socket
handleChatSocket(io);

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

