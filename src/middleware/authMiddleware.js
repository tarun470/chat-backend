import jwt from "jsonwebtoken";
import User from "../models/User.js";
import mongoose from "mongoose";

export const protect = async (req, res, next) => {
  try {
    // -----------------------------
    // 1. READ TOKEN (REST + SOCKET SUPPORT)
    // -----------------------------
    let token = null;

    // REST: Authorization: Bearer <token>
    if (req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }

    // WebSocket support (optional)
    if (!token && req.query?.token) token = req.query.token;

    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }

    if (!process.env.JWT_SECRET) {
      console.error("❌ ERROR: JWT_SECRET missing in environment!");
      // stop server in development
      return res.status(500).json({ message: "Server misconfigured" });
    }

    // -----------------------------
    // 2. VERIFY TOKEN
    // -----------------------------
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({
        message:
          err.name === "TokenExpiredError"
            ? "Session expired. Please login again."
            : "Invalid or malformed token",
      });
    }

    // -----------------------------
    // 3. VALIDATE USER ID FORMAT
    // -----------------------------
    if (!mongoose.Types.ObjectId.isValid(decoded.id)) {
      return res.status(401).json({ message: "Invalid user token data" });
    }

    // -----------------------------
    // 4. LOOKUP USER
    // -----------------------------
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(401).json({ message: "User not found or deleted" });
    }

    if (user.isSuspended === true) {
      return res.status(403).json({ message: "Account suspended" });
    }

    // -----------------------------
    // 5. ATTACH USER + TOKEN TO REQUEST
    // -----------------------------
    req.user = user;
    req.token = token;

    next();
  } catch (err) {
    console.error("protect middleware error:", err);
    return res.status(401).json({ message: "Not authorized" });
  }
};
