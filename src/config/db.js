import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

const connectDB = async () => {
  if (!MONGO_URI) {
    console.error("❌ MONGO_URI not found in environment variables!");
    process.exit(1);
  }

  const connect = async () => {
    try {
      await mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 5000, // 5 seconds
        socketTimeoutMS: 45000, // 45 seconds
        maxPoolSize: 10, // Limit concurrent connections (Render best practice)
        autoIndex: true,
      });

      console.log("✅ MongoDB Atlas Connected Successfully");
    } catch (error) {
      console.error("❌ MongoDB Connection Failed:", error.message);
      console.log("🔁 Retrying in 5 seconds...");
      setTimeout(connect, 5000);
    }
  };

  connect();

  // 🧠 Handle connection lifecycle events
  mongoose.connection.on("disconnected", () => {
    console.warn("⚠️ MongoDB disconnected — retrying...");
    setTimeout(connect, 5000);
  });

  mongoose.connection.on("reconnected", () => {
    console.log("🔄 MongoDB reconnected successfully");
  });

  mongoose.connection.on("error", (err) => {
    console.error("❌ MongoDB connection error:", err.message);
  });
};

export default connectDB;
