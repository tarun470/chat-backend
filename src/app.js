import express from "express";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";

const app = express();

// ✅ Allowed frontend URL (set in .env)
const allowedOrigin = process.env.CLIENT_URL || "https://flutter-frontend-1gz1.onrender.com";

app.use(cors({
  origin: allowedOrigin, // must be exact URL, not "*"
  credentials: true,     // allow cookies / auth headers
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
}));

// ✅ Body parser
app.use(express.json());

// ✅ API routes
app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);

// ✅ Health check / root
app.get("/", (req, res) => {
  res.send("🚀 Chat backend is running successfully on Render!");
});

export default app;
