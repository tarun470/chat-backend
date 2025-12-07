import User from "../models/User.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// ==============================
// REGISTER
// ==============================
export const register = async (req, res) => {
  try {
    const { username, password, nickname } = req.body;

    if (!username || !password || !nickname) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const user = await User.create({
      username,
      password: hashed,
      nickname,
    });

    return res.status(201).json({
      message: "Registered successfully",
      user: {
        id: user._id,
        username: user.username,
        nickname: user.nickname,
      },
    });

  } catch (err) {
    console.error("Register Error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ==============================
// LOGIN — FIXED (IMPORTANT)
// ==============================
export const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password)
      return res.status(400).json({ message: "Missing fields" });

    // MUST fetch password manually because select: false
    const user = await User.findOne({ username }).select("+password");

    if (!user)
      return res.status(404).json({ message: "User not found" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid)
      return res.status(401).json({ message: "Invalid password" });

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      message: "Login success",
      token,
      user: {
        id: user._id,
        username: user.username,
        nickname: user.nickname,
      },
    });

  } catch (err) {
    console.error("Login Error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ==============================
// LOGOUT
// ==============================
export const logout = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user)
      return res.status(404).json({ message: "User not found" });

    user.isOnline = false;
    user.lastSeen = new Date();
    user.socketId = null;
    await user.save();

    return res.json({ message: "Logged out successfully" });

  } catch (err) {
    console.error("Logout Error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
