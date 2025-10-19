import express from "express";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";

const app = express();

// ✅ CORS configuration
// Only allow your deployed Flutter Web frontend
const allowedOrigin = process.env.CLIENT_URL || "*";

app.use(cors({
  origin: allowedOrigin,
  credentials: true, // allow cookies/auth headers
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


