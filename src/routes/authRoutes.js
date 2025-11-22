// routes/authRoutes.js
import express from "express";
import { register, login, logout } from "../controllers/authController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Register a new user
router.post("/register", async (req, res) => {
  try {
    await register(req, res);
  } catch (err) {
    console.error("Register error:", err.message);
    res.status(500).json({ message: "Server error during registration." });
  }
});

// Login existing user
router.post("/login", async (req, res) => {
  try {
    await login(req, res);
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ message: "Server error during login." });
  }
});

// Logout (protected route)
router.post("/logout", protect, async (req, res) => {
  try {
    await logout(req, res);
  } catch (err) {
    console.error("Logout error:", err.message);
    res.status(500).json({ message: "Server error during logout." });
  }
});

export default router;
