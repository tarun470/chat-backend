import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

let isConnected = false; // Prevent multiple connections

const connectDB = async () => {
  if (!MONGO_URI) {
    console.error("❌ ERROR: MONGO_URI missing in environment variables!");
    process.exit(1);
  }

  if (isConnected) {
    console.log("ℹ️ MongoDB already connected. Reusing existing connection.");
    return;
  }

  const connect = async () => {
    try {
      await mongoose.connect(MONGO_URI, {
        maxPoolSize: 20,                 // Better concurrency for chat apps
        minPoolSize: 5,                  // Keep warm connections ready
        serverSelectionTimeoutMS: 5000,  // Fail fast
        socketTimeoutMS: 45000,
        autoIndex: false,                // Improve performance in production
        retryWrites: true,               // Safe writes on network interruptions
        w: "majority",
      });

      isConnected = true;
      console.log("✅ MongoDB Atlas Connected Successfully");
    } 
    catch (error) {
      isConnected = false;
      console.error("❌ MongoDB Connection Failed:", error.message);
      console.log("⏳ Retrying in 5 seconds...");
      setTimeout(connect, 5000);
    }
  };

  connect();

  // ----------------------------------------------------
  // 🔁 Lifecycle Events — auto healing
  // ----------------------------------------------------
  mongoose.connection.on("connected", () => {
    console.log("🟢 MongoDB connection established");
  });

  mongoose.connection.on("disconnected", () => {
    isConnected = false;
    console.warn("🟡 MongoDB disconnected — retrying in 5s…");
    setTimeout(connect, 5000);
  });

  mongoose.connection.on("reconnected", () => {
    isConnected = true;
    console.log("🔄 MongoDB reconnected");
  });

  mongoose.connection.on("error", (err) => {
    console.error("❌ MongoDB error:", err.message);
  });

  // Graceful shutdown (Render recommended)
  process.on("SIGINT", async () => {
    await mongoose.connection.close();
    console.log("🔻 MongoDB disconnected through app termination");
    process.exit(0);
  });
};

export default connectDB;
