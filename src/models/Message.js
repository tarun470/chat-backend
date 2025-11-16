import mongoose from "mongoose";

const reactionSchema = new mongoose.Schema({
  emoji: { type: String, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { _id: false });

const messageSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // optional recipient for 1:1 chats; if null => global/room message
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    roomId: { type: String, default: "global" },

    content: { type: String, default: "" },
    type: { type: String, enum: ["text", "image", "file", "system"], default: "text" },

    // file metadata (if any)
    fileUrl: { type: String, default: null },
    fileName: { type: String, default: null },

    // reply / thread support
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },

    // reactions stored as array of { emoji, user }
    reactions: [reactionSchema],

    // delivered/seen
    deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // list of userIds
    seenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // list of userIds

    edited: { type: Boolean, default: false },
    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // delete for selected users
    deletedForEveryone: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("Message", messageSchema);
