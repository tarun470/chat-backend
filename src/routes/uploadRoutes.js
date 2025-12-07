// routes/uploadRoutes.js
import express from "express";
import multer from "multer";
import { uploadFile } from "../controllers/uploadController.js";
import { protect } from "../middleware/authMiddleware.js";
import path from "path";
import fs from "fs/promises";

const router = express.Router();

// ----------------------------------------
// Ensure uploads directory exists (async)
// ----------------------------------------
const uploadsDir = path.join(process.cwd(), "uploads");

(async () => {
  try {
    await fs.mkdir(uploadsDir, { recursive: true });
    console.log("📁 uploads directory ready");
  } catch (err) {
    console.error("Failed to create uploads directory:", err);
  }
})();

// ----------------------------------------
// FILE VALIDATION HELPERS
// ----------------------------------------
const allowedMime = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "video/mp4",
  "application/pdf",
  "text/plain",
];

const allowedExt = [".png", ".jpg", ".jpeg", ".webp", ".mp4", ".pdf", ".txt"];

// ----------------------------------------
// Multer Storage Engine
// ----------------------------------------
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsDir),

  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext);

    // sanitize + enforce max length
    const safeBase = base.replace(/[^a-z0-9_\-]/gi, "_").slice(0, 40);

    const finalName = `${Date.now()}-${safeBase}-${Math.random()
      .toString(36)
      .substring(2, 8)}${ext}`;

    cb(null, finalName);
  },
});

// ----------------------------------------
// Multer File Filter (MIME + EXTENSION)
// ----------------------------------------
function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();

  if (!allowedMime.includes(file.mimetype) || !allowedExt.includes(ext)) {
    return cb(new Error("Unsupported file type"), false);
  }

  cb(null, true);
}

// ----------------------------------------
// Multer Upload Instance
// ----------------------------------------
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
});

// ----------------------------------------
// Final Route
// ----------------------------------------
router.post(
  "/",
  protect,
  (req, res, next) => {
    upload.single("file")(req, res, async function (err) {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ message: "Upload failed: " + err.code });
      } else if (err) {
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  uploadFile
);

export default router;
