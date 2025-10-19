import express from "express";
import { register, login } from "../controllers/authController.js";

const router = express.Router();

// ✅ Register a new user
router.post("/register", async (req, res, next) => {
  try {
    await register(req, res);
  } catch (err) {
    console.error("Register error:", err.message);
    res.status(500).json({ message: "Server error during registration." });
  }
});

// ✅ Login existing user
router.post("/login", async (req, res, next) => {
  try {
    await login(req, res);
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ message: "Server error during login." });
  }
});

export default router;
