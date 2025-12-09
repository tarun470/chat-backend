import User from "../models/User.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// Ensure secret exists
if (!process.env.JWT_SECRET) {
  console.error("❌ ERROR: JWT_SECRET missing in environment variables!");
  process.exit(1);
}

// =====================================
// REGISTER
// =====================================
export const register = async (req, res) => {
  try {
    let { username, password, nickname } = req.body;

    if (!username || !password || !nickname) {
      return res.status(400).json({ message: "All fields are required" });
    }

    username = username.trim().toLowerCase();
    nickname = nickname.trim();

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    // Check if user exists
    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(409).json({ message: "User already exists" });
    }

    // MODEL WILL HASH PASSWORD AUTOMATICALLY → DO NOT HASH HERE
    const user = await User.create({
      username,
      password,   // plain password − pre-save hook hashes it
      nickname,
      isOnline: true,
      lastSeen: new Date(),
    });

    return res.status(201).json({
      message: "Registration successful",
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

// =====================================
// LOGIN
// =====================================
export const login = async (req, res) => {
  try {
    let { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "Missing fields" });
    }

    username = username.trim().toLowerCase();

    const user = await User.findOne({ username }).select("+password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: "Invalid password" });
    }

    const token = jwt.sign(
      {
        id: user._id,
        username: user.username,
        nickname: user.nickname,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Update online status
    user.isOnline = true;
    user.lastSeen = new Date();
    await user.save();

    return res.status(200).json({
      message: "Login successful",
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

// =====================================
// LOGOUT
// =====================================
export const logout = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

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
