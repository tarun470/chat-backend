// routes/messageRoutes.js
import express from "express";
import {
  getMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  markAsSeen,
  markAsDelivered,
  addReaction,
  removeReaction,
} from "../controllers/messageController.js";

import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// ========================
// MESSAGE CRUD
// ========================

// Fetch messages (pagination, room filter)
router.get("/", protect, getMessages);

// Send message (text, image, file, reply)
router.post("/", protect, sendMessage);

// Edit message
router.put("/:id", protect, editMessage);

// Delete message (for me OR everyone)
router.delete("/:id", protect, deleteMessage);

// Mark message as seen
router.post("/:id/seen", protect, markAsSeen);

// Mark message as delivered
router.post("/:id/delivered", protect, markAsDelivered);

// ========================
// MESSAGE REACTIONS
// ========================

// Add emoji reaction
router.post("/:id/react", protect, addReaction);

// Remove emoji reaction
router.delete("/:id/react", protect, removeReaction);

export default router;
