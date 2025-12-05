import Message from "../models/Message.js";
import User from "../models/User.js";
import mongoose from "mongoose";

// =========================
// Utility: Format message DTO
// =========================
const formatMessage = (m, currentUserId) => {
  const reactionsCount = {};
  (m.reactions || []).forEach((r) => {
    reactionsCount[r.emoji] = (reactionsCount[r.emoji] || 0) + 1;
  });

  const isDelivered = (m.deliveredTo || []).some(
    (id) => id.toString() === currentUserId.toString()
  );

  const isSeen = (m.seenBy || []).some(
    (id) => id.toString() === currentUserId.toString()
  );

  return {
    _id: m._id,
    sender: m.sender,
    content: m.content,
    type: m.type,
    fileUrl: m.fileUrl,
    fileName: m.fileName,
    roomId: m.roomId,
    replyTo: m.replyTo || null,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    edited: m.edited,
    reactions: reactionsCount,
    isDelivered,
    isSeen,
    deletedForEveryone: m.deletedForEveryone || false,
  };
};

// =========================
// GET messages (pagination)
// =========================
export const getMessages = async (req, res) => {
  try {
    const room = req.query.room || "global";
    const limit = Math.min(parseInt(req.query.limit || "50"), 200);
    const before = req.query.before ? new Date(req.query.before) : null;

    const filter = {
      roomId: room,
      deletedForEveryone: { $ne: true },
    };

    if (before) filter.createdAt = { $lt: before };

    const rawMessages = await Message.find(filter)
      .sort({ createdAt: -1 }) // newest first (efficient)
      .limit(limit)
      .populate("sender", "username nickname avatar")
      .populate({
        path: "replyTo",
        populate: {
          path: "sender",
          select: "username nickname avatar",
        },
      })
      .lean(); // major speed boost

    // Filter "delete for me"
    const userId = req.user._id.toString();
    const filtered = rawMessages.filter((m) => {
      const delList = (m.deletedFor || []).map((id) => id.toString());
      return !delList.includes(userId);
    });

    const messages = filtered.reverse().map((m) => formatMessage(m, req.user._id));

    res.json({
      messages,
      hasMore: filtered.length === limit, // Infinite scroll helper
    });
  } catch (err) {
    console.error("getMessages error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// =========================
// SEND message (REST fallback)
// =========================
export const sendMessage = async (req, res) => {
  try {
    const { content, type, roomId, receiver, replyTo, fileUrl, fileName } =
      req.body;

    const msg = await Message.create({
      sender: req.user._id,
      receiver: receiver ? new mongoose.Types.ObjectId(receiver) : null,
      roomId: roomId || "global",
      content: content || "",
      type: type || "text",
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      replyTo: replyTo || null,
    });

    const populated = await Message.findById(msg._id)
      .populate("sender", "username nickname avatar")
      .lean();

    res.status(201).json(formatMessage(populated, req.user._id));
  } catch (err) {
    console.error("sendMessage error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// =========================
// EDIT message
// =========================
export const editMessage = async (req, res) => {
  try {
    const id = req.params.id;
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

    res.json(formatMessage(populated, req.user._id));
  } catch (err) {
    console.error("editMessage error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// =========================
// DELETE message
// =========================
export const deleteMessage = async (req, res) => {
  try {
    const id = req.params.id;
    const forEveryone = req.query.forEveryone === "true";

    const msg = await Message.findById(id);
    if (!msg) return res.status(404).json({ message: "Message not found" });

    const isSender = msg.sender.toString() === req.user._id.toString();

    if (forEveryone) {
      if (!isSender)
        return res.status(403).json({ message: "Only sender can delete for all" });

      msg.deletedForEveryone = true;
      await msg.save();
      return res.json({ message: "Deleted for everyone" });
    }

    // delete only for current user
    if (!msg.deletedFor) msg.deletedFor = [];
    msg.deletedFor.push(req.user._id);
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

    const userId = req.user._id.toString();

    if (!msg.seenBy.map(String).includes(userId)) {
      msg.seenBy.push(userId);
      await msg.save();
    }

    res.json({ message: "Seen updated" });
  } catch (err) {
    console.error("markAsSeen error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
