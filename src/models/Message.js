import mongoose from "mongoose";

//
// REACTION SUB-SCHEMA
// Stores: { emoji: "❤️", user: ObjectId }
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
    //
    // SENDER & RECEIVER
    //
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // null => room or global chat
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    //
    // ROOM SYSTEM
    //
    roomId: {
      type: String,
      default: "global",
      index: true,
    },

    //
    // MESSAGE CONTENT
    //
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

    //
    // FILE METADATA
    //
    fileUrl: { type: String, default: null },
    fileName: { type: String, default: null },

    //
    // REPLY / THREAD
    //
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
      index: true,
    },

    //
    // REACTIONS
    //
    reactions: {
      type: [reactionSchema],
      default: [],
    },

    //
    // DELIVERY / READ RECEIPTS
    //
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

    //
    // EDIT & DELETE STATUS
    //
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
// INDEXES FOR PERFORMANCE
//

// Frequently queried combinations
messageSchema.index({ roomId: 1, createdAt: -1 });
messageSchema.index({ sender: 1, createdAt: -1 });
messageSchema.index({ receiver: 1, createdAt: -1 });
messageSchema.index({ replyTo: 1 });
messageSchema.index({ type: 1 });

//
// AUTO-POPULATE SENDER + REPLY SENDER
//
messageSchema.pre(/^find/, function (next) {
  this.populate("sender", "username nickname avatar")
    .populate({
      path: "replyTo",
      populate: { path: "sender", select: "username nickname avatar" },
    });
  next();
});

export default mongoose.model("Message", messageSchema);
