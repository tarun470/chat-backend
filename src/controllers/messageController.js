import Message from "../models/Message.js";
import User from "../models/User.js";
import mongoose from "mongoose";

/**
 * GET /api/messages?room=ROOM_ID&limit=50&before=TIMESTAMP
 * Returns messages for a room (or global)
 * Filters out messages deleted for the requesting user.
 */
export const getMessages = async (req, res) => {
  try {
    const room = req.query.room || "global";
    const limit = Math.min(parseInt(req.query.limit || "100"), 500);
    const before = req.query.before ? new Date(req.query.before) : null;

    const filter = { roomId: room, deletedForEveryone: { $ne: true } };

    if (before) filter.createdAt = { $lt: before };

    // fetch messages, populate sender and replyTo.sender
    const messages = await Message.find(filter)
      .sort({ createdAt: 1 })
      .limit(limit)
      .populate("sender", "username nickname avatar")
      .populate({
        path: "replyTo",
        populate: { path: "sender", select: "username nickname avatar" },
      });

    // remove messages that are deleted for this user specifically
    const filtered = messages.filter((m) => {
      if (!m.deletedFor || m.deletedFor.length === 0) return true;
      const deletedForIds = m.deletedFor.map((id) => id.toString());
      return !deletedForIds.includes(req.user._id.toString());
    });

    // serialize reactions to counts
    const out = filtered.map((m) => {
      const reactionsCount = {};
      (m.reactions || []).forEach((r) => {
        reactionsCount[r.emoji] = (reactionsCount[r.emoji] || 0) + 1;
      });

      return {
        _id: m._id,
        sender: m.sender,
        content: m.content,
        type: m.type,
        fileUrl: m.fileUrl,
        fileName: m.fileName,
        roomId: m.roomId,
        replyTo: m.replyTo,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        isDelivered: (m.deliveredTo || []).some((id) => id.toString() === req.user._id.toString()),
        isSeen: (m.seenBy || []).some((id) => id.toString() === req.user._id.toString()),
        edited: m.edited,
        reactions: reactionsCount,
        deletedForEveryone: m.deletedForEveryone || false,
      };
    });

    res.json(out);
  } catch (err) {
    console.error("getMessages error:", err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/messages
 * REST fallback to create a message. Socket will also be used in realtime.
 * Body: { content, type, roomId, receiver (optional), replyTo (opt), fileUrl, fileName }
 */
export const sendMessage = async (req, res) => {
  try {
    const { content, type, roomId, receiver, replyTo, fileUrl, fileName } = req.body;
    const senderId = req.user._id;

    const msg = await Message.create({
      sender: senderId,
      receiver: receiver ? mongoose.Types.ObjectId(receiver) : null,
      roomId: roomId || "global",
      content: content || "",
      type: type || "text",
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      replyTo: replyTo || null,
    });

    // populate and return
    const out = await Message.findById(msg._id).populate("sender", "username nickname avatar");
    res.status(201).json(out);
  } catch (err) {
    console.error("sendMessage error:", err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * PUT /api/messages/:id
 * Edit a message (only sender allowed)
 */
export const editMessage = async (req, res) => {
  try {
    const id = req.params.id;
    const { content } = req.body;
    const msg = await Message.findById(id);
    if (!msg) return res.status(404).json({ message: "Message not found" });
    if (msg.sender.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Not allowed" });

    msg.content = content;
    msg.edited = true;
    await msg.save();

    const populated = await msg.populate("sender", "username nickname avatar").execPopulate();
    res.json(populated);
  } catch (err) {
    console.error("editMessage error:", err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * DELETE /api/messages/:id
 * query param ?forEveryone=true will delete for everyone (only allowed for sender)
 */
export const deleteMessage = async (req, res) => {
  try {
    const id = req.params.id;
    const forEveryone = req.query.forEveryone === "true";
    const msg = await Message.findById(id);
    if (!msg) return res.status(404).json({ message: "Message not found" });

    const isSender = msg.sender.toString() === req.user._id.toString();

    if (forEveryone) {
      if (!isSender) return res.status(403).json({ message: "Not allowed to delete for everyone" });
      msg.deletedForEveryone = true;
      await msg.save();
      return res.json({ message: "Deleted for everyone" });
    } else {
      // mark deleted for this user only
      msg.deletedFor = msg.deletedFor || [];
      msg.deletedFor.push(req.user._id);
      await msg.save();
      return res.json({ message: "Deleted for you" });
    }
  } catch (err) {
    console.error("deleteMessage error:", err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/messages/:id/seen
 * Marks message as seen by this user (used by REST fallback)
 */
export const markAsSeen = async (req, res) => {
  try {
    const id = req.params.id;
    const msg = await Message.findById(id);
    if (!msg) return res.status(404).json({ message: "Message not found" });

    const userId = req.user._id;
    if (!msg.seenBy.map(String).includes(userId.toString())) {
      msg.seenBy.push(userId);
      await msg.save();
    }
    return res.json({ message: "Marked as seen" });
  } catch (err) {
    console.error("markAsSeen error:", err);
    res.status(500).json({ message: err.message });
  }
};

