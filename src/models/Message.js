import mongoose from "mongoose";

//
// REACTION SUB-SCHEMA
//
const reactionSchema = new mongoose.Schema(
  {
    emoji: { type: String, required: true, trim: true },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  { _id: false, timestamps: false }
);

//
// MESSAGE SCHEMA
//
const messageSchema = new mongoose.Schema(
  {
    // SENDER INFO
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // 🔥 ADD THIS → Store nickname permanently in message
    senderName: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    roomId: {
      type: String,
      default: "general",
      index: true,
    },

    content: {
      type: String,
      default: "",
      trim: true,
    },

    type: {
      type: String,
      enum: ["text", "image", "file", "system"],
      default: "text",
      index: true,
    },

    fileUrl: { type: String, default: null },
    fileName: { type: String, default: null },

    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
      index: true,
    },

    reactions: {
      type: [reactionSchema],
      default: [],
    },

    deliveredTo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        index: true,
      },
    ],

    seenBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        index: true,
      },
    ],

    edited: { type: Boolean, default: false },

    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        index: true,
      },
    ],

    deletedForEveryone: { type: Boolean, default: false },
  },
  { timestamps: true }
);

//
// INDEXES
//
messageSchema.index({ roomId: 1, createdAt: -1 });
messageSchema.index({ sender: 1, createdAt: -1 });
messageSchema.index({ senderName: 1 });
messageSchema.index({ type: 1 });
messageSchema.index({ createdAt: -1 });

export default mongoose.model("Message", messageSchema);
