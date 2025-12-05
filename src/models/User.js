import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    //
    // AUTH INFO
    //
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    password: {
      type: String,
      required: true,
      select: false, // prevents leaking password anywhere
    },

    //
    // PROFILE INFO
    //
    nickname: {
      type: String,
      required: true,
      trim: true,
    },

    avatar: {
      type: String,
      default: "https://api.dicebear.com/7.x/identicon/svg?seed=user",
    },

    bio: {
      type: String,
      trim: true,
      default: "",
    },

    //
    // STATUS & PRESENCE
    //
    isOnline: {
      type: Boolean,
      default: false,
      index: true,
    },

    lastSeen: {
      type: Date,
      default: null,
    },

    //
    // DEVICE & PUSH
    //
    fcmToken: {
      type: String,
      default: null,
    },

    deviceInfo: {
      type: String,
      default: null,
    },

    //
    // SOCKET CONNECTION
    //
    socketId: {
      type: String,
      default: null,
      index: true,
    },

    //
    // PRIVACY FEATURES
    //
    blockedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        index: true,
      },
    ],

    allowReadReceipts: {
      type: Boolean,
      default: true,
    },

    allowLastSeen: {
      type: Boolean,
      default: true,
    },

    //
    // ACCOUNT STATUS
    //
    suspended: {
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
// VIRTUALS
//
userSchema.virtual("displayName").get(function () {
  return this.nickname || this.username;
});

//
// INDEXES FOR PERFORMANCE
//
userSchema.index({ username: 1 });
userSchema.index({ isOnline: 1 });
userSchema.index({ socketId: 1 });
userSchema.index({ suspended: 1 });

export default mongoose.model("User", userSchema);
