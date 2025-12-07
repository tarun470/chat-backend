import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    // AUTH FIELDS
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      minlength: 3,
      maxlength: 30,
      match: /^[a-zA-Z0-9._-]+$/, // prevent unsafe characters
    },

    password: {
      type: String,
      required: true,
      select: false,
      minlength: 6,
    },

    // PROFILE INFO
    nickname: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 30,
    },

    avatar: {
      type: String,
      default: "https://api.dicebear.com/7.x/identicon/svg?seed=user",
    },

    bio: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },

    // STATUS & PRESENCE
    isOnline: {
      type: Boolean,
      default: false,
      index: true,
    },

    lastSeen: {
      type: Date,
      default: null,
    },

    // DEVICE INFO
    fcmToken: { type: String, default: null },
    deviceInfo: { type: String, default: null },

    // SOCKET CONNECTION
    socketId: {
      type: String,
      default: null,
      index: true,
    },

    // PRIVACY SETTINGS
    blockedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        index: true,
      },
    ],

    allowReadReceipts: { type: Boolean, default: true },
    allowLastSeen: { type: Boolean, default: true },

    // ACCOUNT STATUS
    isSuspended: {   // <-- FIXED NAME
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

//
// PASSWORD HASHING (IMPORTANT SECURITY FIX)
//
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

//
// VIRTUALS
//
userSchema.virtual("displayName").get(function () {
  return this.nickname || this.username;
});

//
// INDEXES
//
userSchema.index({ username: 1 });
userSchema.index({ nickname: 1 }); // <-- added for search performance
userSchema.index({ isOnline: 1 });
userSchema.index({ socketId: 1 });
userSchema.index({ isSuspended: 1 });

export default mongoose.model("User", userSchema);
