import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const connectDB = async () => {
  const MONGO_URI = process.env.MONGO_URI;

  const connect = async () => {
    try {
      await mongoose.connect(MONGO_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 5000, // retry quickly if network unstable
        socketTimeoutMS: 45000,
      });
      console.log("✅ MongoDB Atlas Connected Successfully");
    } catch (error) {
      console.error("❌ MongoDB Connection Failed:", error.message);
      console.log("🔁 Retrying in 5 seconds...");
      setTimeout(connect, 5000);
    }
  };

  mongoose.connection.on("connected", () => {
    console.log("🟢 MongoDB connected");
  });

  mongoose.connection.on("reconnected", () => {
    console.log("🟩 MongoDB reconnected");
  });

  mongoose.connection.on("disconnected", () => {
    console.log("⚠️ MongoDB disconnected — retrying...");
    setTimeout(connect, 5000);
  });

  mongoose.connection.on("error", (err) => {
    console.error("🔴 MongoDB error:", err.message);
  });

  // Start initial connection
  connect();
};

export default connectDB;

