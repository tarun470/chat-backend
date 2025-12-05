// routes/messageRoutes.js
import express from "express";
import {
  getMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  markAsSeen,
} from "../controllers/messageController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Fetch messages (supports pagination, room filter)
router.get("/", protect, getMessages);

// Create message (text, file, image, reply)
router.post("/", protect, sendMessage);

// Edit message (sender only)
router.put("/:id", protect, editMessage);

// Delete message (local delete OR delete for everyone)
router.delete("/:id", protect, deleteMessage);

// Mark message as seen
router.post("/:id/seen", protect, markAsSeen);

export default router;
