import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import app from "./app.js";
import { handleChatSocket } from "./sockets/chatSocket.js";

dotenv.config();

// ------------------------------
// 🟢 Connect MongoDB
// ------------------------------
connectDB();

// ------------------------------
// 🟢 Create HTTP server for both Express + Socket.IO
// ------------------------------
const server = http.createServer(app);

// ------------------------------
// 🟢 Define allowed frontend origin
//    (Matches app.js CORS)
// ------------------------------
const allowedOrigin =
  process.env.CLIENT_URL || "https://flutter-frontend-1gz1.onrender.com";

// ------------------------------
// 🟢 Socket.IO with secure CORS
// ------------------------------
const io = new Server(server, {
  cors: {
    origin: allowedOrigin,
    credentials: true,
    methods: ["GET", "POST"],
  },
  pingTimeout: 30000,  // improve stability on Render
  pingInterval: 25000,
  allowEIO3: true,      // backward compatibility
});

// ------------------------------
// 🟢 Initialize Chat Socket Handlers
// ------------------------------
handleChatSocket(io);

// ------------------------------
// 🟢 Start Server
// ------------------------------
const PORT = process.env.PORT || 5000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Allowed origin: ${allowedOrigin}`);
  console.log(`🟣 Socket.IO active and listening...`);
});

// ------------------------------
// 🛑 Crash Protection
// ------------------------------
process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION 💥 Shutting down server:", err);
});

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION 💥:", err);
});
