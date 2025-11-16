import express from "express";
import cors from "cors";
import path from "path";

import authRoutes from "./routes/authRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";

const app = express();

const allowedOrigin = process.env.CLIENT_URL || "https://flutter-frontend-1gz1.onrender.com";

app.use(cors({
 
  origin: allowedOrigin,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],

  origin: allowedOrigin,         // must be exact frontend URL
  credentials: true,             // allow cookies / auth headers
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"], // allow these headers

}));

app.use(express.json());

 
// 🔥 Serve uploads
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// Routes

 
app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/upload", uploadRoutes);

app.get("/", (req, res) => {
  res.send("🚀 Chat backend with uploads is running!");
});

 HEAD

app.get("/", (req, res) => {
  res.send("🚀 Chat backend is running successfully on Render!");
});

 
export default app;
