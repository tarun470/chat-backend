import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const protect = async (req, res, next) => {
  try {
    // -----------------------------
    // 1. CHECK FOR AUTH HEADER
    // -----------------------------
    const auth = req.headers.authorization;

    if (!auth || !auth.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = auth.split(" ")[1];

    if (!process.env.JWT_SECRET) {
      console.error("❌ ERROR: JWT_SECRET missing in environment");
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
            : "Invalid token",
      });
    }

    // -----------------------------
    // 3. FIND USER IN DATABASE
    // -----------------------------
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(401).json({ message: "User no longer exists" });
    }

    // Optional: if your system supports disabling users
    if (user.isSuspended) {
      return res
        .status(403)
        .json({ message: "Account suspended. Contact support." });
    }

    // -----------------------------
    // 4. ATTACH USER TO REQUEST
    // -----------------------------
    req.user = user;

    next();
  } catch (err) {
    console.error("protect error:", err);
    return res.status(401).json({ message: "Not authorized" });
  }
};
