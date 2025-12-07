import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

let isConnected = false;
let isRetrying = false; // prevent duplicate reconnection loops

const connectDB = async () => {
  if (!MONGO_URI) {
    console.error("❌ ERROR: MONGO_URI missing!");
    process.exit(1);
  }

  if (isConnected) {
    console.log("ℹ️ Mongo already connected.");
    return;
  }

  const connect = async () => {
    try {
      await mongoose.connect(MONGO_URI, {
        maxPoolSize: 50,
        minPoolSize: 5,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        autoIndex: process.env.NODE_ENV !== "production",
        retryWrites: true,
        w: "majority",
      });

      isConnected = true;
      isRetrying = false;
      console.log("✅ MongoDB Connected");
    } catch (error) {
      isConnected = false;

      if (!isRetrying) {
        isRetrying = true;
        console.error("❌ Connection Failed:", error.message);
        console.log("⏳ Retrying in 5 seconds…");
        setTimeout(connect, 5000);
      }
    }
  };

  connect();

  mongoose.connection.on("disconnected", () => {
    isConnected = false;
    if (!isRetrying) {
      isRetrying = true;
      console.warn("🟡 MongoDB disconnected — reconnecting…");
      setTimeout(connect, 5000);
    }
  });

  mongoose.connection.on("reconnected", () => {
    isConnected = true;
    isRetrying = false;
    console.log("🔄 MongoDB reconnected");
  });

  mongoose.connection.on("error", (err) => {
    console.error("❌ MongoDB error:", err.message);
  });

  // Graceful shutdown for both SIGINT & SIGTERM
  const closeConnection = async () => {
    await mongoose.connection.close();
    console.log("🔻 MongoDB disconnected gracefully");
    process.exit(0);
  };

  process.on("SIGINT", closeConnection);
  process.on("SIGTERM", closeConnection);
};

export default connectDB;
