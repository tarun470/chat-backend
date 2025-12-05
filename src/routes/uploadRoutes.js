// routes/uploadRoutes.js
import express from "express";
import multer from "multer";
import { uploadFile } from "../controllers/uploadController.js";
import { protect } from "../middleware/authMiddleware.js";
import path from "path";
import fs from "fs";

const router = express.Router();

// -------------------------------
// Ensure uploads folder exists
// -------------------------------
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log("📁 Created uploads directory");
}

// -------------------------------
// Multer Storage (local)
// -------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),

  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    const safeBase = base.replace(/[^a-z0-9_\-]/gi, "_"); // sanitize filename

    const finalName =
      `${Date.now()}-${safeBase}-${Math.random()
        .toString(36)
        .substring(2, 8)}${ext}`;

    cb(null, finalName);
  },
});

// -------------------------------
// File Filter (optional security)
// Limits allowed file types if needed
// -------------------------------
function fileFilter(req, file, cb) {
  const allowed = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "video/mp4",
    "application/pdf",
    "text/plain",
  ];

  if (!allowed.includes(file.mimetype)) {
    return cb(new Error("Unsupported file type"), false);
  }

  cb(null, true);
}

// -------------------------------
// Multer Upload Middleware
// -------------------------------
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB
  },
});

// -------------------------------
// Route
// -------------------------------
router.post("/", protect, (req, res, next) => {
  upload.single("file")(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ message: `Upload error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ message: err.message });
    }
    next();
  });
}, uploadFile);

export default router;
