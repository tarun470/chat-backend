// routes/authRoutes.js
import express from "express";
import { register, login, logout } from "../controllers/authController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// AUTH ROUTES
router.post("/register", register);
router.post("/login", login);

// Get logged-in user info
router.get("/me", protect, (req, res) => {
  res.json({
    user: req.user,
    message: "Authenticated",
  });
});

// Logout user
router.post("/logout", protect, logout);

export default router;
