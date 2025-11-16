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

router.get("/", protect, getMessages);
router.post("/", protect, sendMessage);
router.put("/:id", protect, editMessage);
router.delete("/:id", protect, deleteMessage);
router.post("/:id/seen", protect, markAsSeen);

export default router;
