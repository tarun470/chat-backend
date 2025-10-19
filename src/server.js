import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import app from "./app.js";
import { handleChatSocket } from "./sockets/chatSocket.js";

// ✅ Load environment variables
dotenv.config();

// ✅ Connect to MongoDB Atlas
connectDB();

// ✅ Create HTTP server from Express app
const server = http.createServer(app);

// ✅ Define allowed origins (for CORS)
const allowedOrigins = [
  process.env.CLIENT_URL,           // your Flutter web app (Render/Firebase URL)
  "http://localhost:5173",          // local dev (optional)
  "http://localhost:3000"           // optional, for testing
].filter(Boolean); // removes undefined/null values

// ✅ Initialize Socket.IO with proper CORS
const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length > 0 ? allowedOrigins : "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// ✅ Initialize chat socket handler (broadcast, etc.)
handleChatSocket(io);

// ✅ Simple root route to verify deployment
app.get("/", (req, res) => {
  res.send("🚀 Chat backend is running successfully on Render!");
});

// ✅ Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Socket.IO active and listening...`);
});
