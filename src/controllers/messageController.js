import Message from "../models/Message.js";
import User from "../models/User.js";
import mongoose from "mongoose";

// =========================
// Utility: Format Message DTO
// =========================
const formatMessage = (msg, currentUserId) => {
  // Build reaction summary
  const reactionSummary = {};
  (msg.reactions || []).forEach(({ emoji }) => {
    reactionSummary[emoji] = (reactionSummary[emoji] || 0) + 1;
  });

  return {
    _id: msg._id,
    sender: msg.sender,
    content: msg.content,
    type: msg.type,
    fileUrl: msg.fileUrl,
    fileName: msg.fileName,
    roomId: msg.roomId,
    replyTo: msg.replyTo || null,
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt,
    edited: msg.edited,

    reactions: reactionSummary,

    isDelivered: msg.deliveredTo?.includes(currentUserId) || false,
    isSeen: msg.seenBy?.includes(currentUserId) || false,

    deletedForEveryone: msg.deletedForEveryone || false,
  };
};

// =========================
// GET Messages (Paginated)
// =========================
export const getMessages = async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const roomId = req.query.room || "global";
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const before = req.query.before ? new Date(req.query.before) : null;

    const filter = {
      roomId,
      deletedForEveryone: { $ne: true },
    };

    if (before) filter.createdAt = { $lt: before };

    const raw = await Message.find(filter)
      .sort({ createdAt: -1 }) // fastest index-friendly sorting
      .limit(limit)
      .populate("sender", "username nickname avatar")
      .populate({
        path: "replyTo",
        populate: { path: "sender", select: "username nickname avatar" },
      })
      .lean();

    // Remove "delete for me"
    const cleaned = raw.filter((m) => !(m.deletedFor || []).includes(userId));

    const messages = cleaned.reverse().map((m) => formatMessage(m, userId));

    return res.json({
      messages,
      hasMore: cleaned.length === limit,
    });
  } catch (err) {
    console.error("getMessages error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// =========================
// SEND Message
// =========================
export const sendMessage = async (req, res) => {
  try {
    const { content, type = "text", roomId = "global", receiver, replyTo, fileUrl, fileName } =
      req.body;

    // Basic validation
    if (!content && !fileUrl) {
      return res.status(400).json({ message: "Message cannot be empty" });
    }

    const message = await Message.create({
      sender: req.user._id,
      receiver: receiver ? new mongoose.Types.ObjectId(receiver) : null,
      roomId,
      content,
      type,
      replyTo: replyTo || null,
      fileUrl: fileUrl || null,
      fileName: fileName || null,
    });

    const populated = await Message.findById(message._id)
      .populate("sender", "username nickname avatar")
      .populate({
        path: "replyTo",
        populate: { path: "sender", select: "username nickname avatar" },
      })
      .lean();

    return res.status(201).json(formatMessage(populated, req.user._id));
  } catch (err) {
    console.error("sendMessage error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// =========================
// EDIT Message
// =========================
export const editMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    const msg = await Message.findById(id);
    if (!msg) return res.status(404).json({ message: "Message not found" });

    if (msg.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not allowed" });
    }

    msg.content = content;
    msg.edited = true;
    await msg.save();

    const populated = await Message.findById(id)
      .populate("sender", "username nickname avatar")
      .lean();

    return res.json(formatMessage(populated, req.user._id));
  } catch (err) {
    console.error("editMessage error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// =========================
// DELETE Message
// =========================
export const deleteMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const forEveryone = req.query.forEveryone === "true";

    const msg = await Message.findById(id);
    if (!msg) return res.status(404).json({ message: "Message not found" });

    const isSender = msg.sender.toString() === req.user._id.toString();

    // DELETE FOR EVERYONE
    if (forEveryone) {
      if (!isSender)
        return res.status(403).json({ message: "Only sender can delete for all" });

      msg.deletedForEveryone = true;
      await msg.save();

      return res.json({ message: "Deleted for everyone" });
    }

    // DELETE FOR USER ONLY
    msg.deletedFor = Array.from(new Set([...(msg.deletedFor || []), req.user._id]));
    await msg.save();

    return res.json({ message: "Deleted for you" });
  } catch (err) {
    console.error("deleteMessage error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// =========================
// MARK AS SEEN
// =========================
export const markAsSeen = async (req, res) => {
  try {
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ message: "Message not found" });

    const userId = req.user._id;

    if (!msg.seenBy.includes(userId)) {
      msg.seenBy.push(userId);
      await msg.save();
    }

    return res.json({ message: "Seen updated" });
  } catch (err) {
    console.error("markAsSeen error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
