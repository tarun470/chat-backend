import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },

    // profile
    nickname: { type: String, required: true }, // <-- NOW MANDATORY
    avatar: { type: String, default: null },

    // real-time status
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: null },

    // push notifications
    fcmToken: { type: String, default: null },

    // socket
    socketId: { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);

