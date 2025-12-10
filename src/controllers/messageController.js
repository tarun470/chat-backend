import Message from "../models/Message.js";

// =========================
// FORMAT MESSAGE DTO  (FIXED VERSION)
// =========================
const formatMessage = (msg, currentUserId) => {
  const reactionSummary = {};
  (msg.reactions || []).forEach(({ emoji }) => {
    reactionSummary[emoji] = (reactionSummary[emoji] || 0) + 1;
  });

  return {
    _id: msg._id,

    senderId: msg.sender?._id?.toString() || msg.sender?.toString(),
    senderName: msg.sender?.nickname || "Unknown",
    senderUsername: msg.sender?.username || null,
    avatar: msg.sender?.avatar || null,

    content: msg.content,
    type: msg.type,
    fileUrl: msg.fileUrl,
    fileName: msg.fileName,
    roomId: msg.roomId,

    replyTo: msg.replyTo
      ? {
          id: msg.replyTo._id,
          content: msg.replyTo.content,
          senderName: msg.replyTo.sender?.nickname || "Unknown",
          senderAvatar: msg.replyTo.sender?.avatar || null,
          type: msg.replyTo.type,
        }
      : null,

    // ⭐ MAIN FIX – ALWAYS SEND ISO STRING
    createdAt: msg.createdAt ? new Date(msg.createdAt).toISOString() : null,
    updatedAt: msg.updatedAt ? new Date(msg.updatedAt).toISOString() : null,
    edited: msg.edited,

    reactions: reactionSummary,

    isDelivered: msg.deliveredTo?.map(String).includes(currentUserId) || false,
    isSeen: msg.seenBy?.map(String).includes(currentUserId) || false,

    deletedForEveryone: msg.deletedForEveryone || false,
  };
};

// =========================
// GET MESSAGES
// =========================
export const getMessages = async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const roomId = req.query.room || "global";
    const limit = Math.min(Number(req.query.limit || 50), 200);

    const raw = await Message.find({
      roomId,
      deletedForEveryone: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("sender", "username nickname avatar")
      .populate({
        path: "replyTo",
        populate: { path: "sender", select: "username nickname avatar" },
      })
      .lean();

    const cleaned = raw.filter(
      (m) => !(m.deletedFor || []).map(String).includes(userId)
    );

    return res.json({
      messages: cleaned.reverse().map((m) => formatMessage(m, userId)),
      hasMore: cleaned.length === limit,
    });
  } catch (err) {
    console.error("getMessages error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// =========================
// SEND MESSAGE
// =========================
export const sendMessage = async (req, res) => {
  try {
    const { content, type = "text", roomId = "global", replyTo, fileUrl, fileName } = req.body;

    if (!content && !fileUrl)
      return res.status(400).json({ message: "Message cannot be empty" });

    const msg = await Message.create({
      sender: req.user._id,
      roomId,
      content,
      type,
      replyTo: replyTo || null,
      fileUrl: fileUrl || null,
      fileName: fileName || null,
    });

    const populated = await Message.findById(msg._id)
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
// EDIT MESSAGE
// =========================
export const editMessage = async (req, res) => {
  try {
    const { content } = req.body;
    const msg = await Message.findById(req.params.id);

    if (!msg) return res.status(404).json({ message: "Message not found" });
    if (msg.sender.toString() !== req.user._id.toString())
      return res.status(403).json({ message: "Not allowed" });

    msg.content = content;
    msg.edited = true;
    await msg.save();

    const populated = await Message.findById(msg._id)
      .populate("sender", "username nickname avatar")
      .lean();

    return res.json(formatMessage(populated, req.user._id));
  } catch (err) {
    console.error("editMessage error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// =========================
// DELETE MESSAGE
// =========================
export const deleteMessage = async (req, res) => {
  try {
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ message: "Message not found" });

    const forEveryone = req.query.forEveryone === "true";

    if (forEveryone) {
      if (msg.sender.toString() !== req.user._id.toString())
        return res.status(403).json({ message: "Only sender can delete for all" });

      msg.deletedForEveryone = true;
      await msg.save();

      return res.json({ message: "Deleted for everyone" });
    }

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

    if (!msg.seenBy.map(String).includes(userId.toString())) {
      msg.seenBy.push(userId);
      await msg.save();
    }

    return res.json({ message: "Seen updated" });
  } catch (err) {
    console.error("markAsSeen error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// =========================
// MARK AS DELIVERED
// =========================
export const markAsDelivered = async (req, res) => {
  try {
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ message: "Message not found" });

    const userId = req.user._id;

    if (!msg.deliveredTo.map(String).includes(userId.toString())) {
      msg.deliveredTo.push(userId);
      await msg.save();
    }

    return res.json({ message: "Delivered updated" });
  } catch (err) {
    console.error("markAsDelivered error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// =========================
// ADD REACTION
// =========================
export const addReaction = async (req, res) => {
  try {
    const { emoji } = req.body;

    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ message: "Message not found" });

    msg.reactions.push({ user: req.user._id, emoji });
    await msg.save();

    return res.json({ message: "Reaction added" });
  } catch (err) {
    console.error("addReaction error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// =========================
// REMOVE REACTION
// =========================
export const removeReaction = async (req, res) => {
  try {
    const { emoji } = req.body;

    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ message: "Message not found" });

    msg.reactions = msg.reactions.filter(
      (r) =>
        !(r.user.toString() === req.user._id.toString() && r.emoji === emoji)
    );

    await msg.save();

    return res.json({ message: "Reaction removed" });
  } catch (err) {
    console.error("removeReaction error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

