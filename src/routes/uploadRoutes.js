// routes/uploadRoutes.js
import express from "express";
import multer from "multer";
import { uploadFile } from "../controllers/uploadController.js";
import { protect } from "../middleware/authMiddleware.js";
import path from "path";
import fs from "fs";

const router = express.Router();

// ensure uploads directory
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// simple disk storage (use S3 in prod)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

router.post("/", protect, upload.single("file"), uploadFile);

export default router;
