import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },

    // real-time status
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: null },

    // profile
    avatar: { type: String, default: null },
    nickname: { type: String, default: null },

    // push token for FCM (optional)
    fcmToken: { type: String, default: null },

    // optional socket id (not persisted for long-term but helpful)
    socketId: { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
