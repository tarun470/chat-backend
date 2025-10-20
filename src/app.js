import express from "express";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";

const app = express();

const allowedOrigin = process.env.CLIENT_URL || "https://your-frontend.onrender.com";

app.use(cors({
  origin: allowedOrigin,         // must be exact frontend URL
  credentials: true,             // allow cookies / auth headers
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"], // allow these headers
}));

app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);

app.get("/", (req, res) => {
  res.send("🚀 Chat backend is running successfully on Render!");
});

export default app;
