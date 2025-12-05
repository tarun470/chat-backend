import express from "express";
import cors from "cors";
import path from "path";

import authRoutes from "./routes/authRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";

const app = express();

// --------------------------------------------------------------------
// 🌍 Allowed frontend URL (Flutter Web or local)
// --------------------------------------------------------------------
const allowedOrigin =
  process.env.CLIENT_URL || "https://flutter-frontend-1gz1.onrender.com";

// --------------------------------------------------------------------
// 🛡 CORS CONFIG - CLEAN + CORRECT
// --------------------------------------------------------------------
app.use(
  cors({
    origin: allowedOrigin,               // exact frontend URL
    credentials: true,                   // allow cookies / auth headers
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Enable JSON body parsing
app.use(express.json());

// --------------------------------------------------------------------
// 📁 Serve uploaded files
// --------------------------------------------------------------------
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// --------------------------------------------------------------------
// 🛣 API ROUTES
// --------------------------------------------------------------------
app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/upload", uploadRoutes);

// --------------------------------------------------------------------
// ROOT ROUTE (single clean response)
// --------------------------------------------------------------------
app.get("/", (req, res) => {
  res.send("🚀 Chat backend is running successfully on Render!");
});

export default app;
