import path from "path";
import fs from "fs/promises";

// Allowed file extensions
const allowedExtensions = [
  ".png", ".jpg", ".jpeg", ".webp",
  ".pdf", ".txt",
  ".doc", ".docx",
  ".zip", ".rar"
];

// Allowed MIME types
const allowedMime = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/zip",
  "application/x-rar-compressed",
];

export const uploadFile = async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ message: "No file uploaded" });

    const filePath = req.file.path;
    const fileExt = path.extname(req.file.originalname).toLowerCase();

    // ---- SECURITY 1: Validate MIME + extension ----
    if (!allowedMime.includes(req.file.mimetype) || !allowedExtensions.includes(fileExt)) {
      await fs.unlink(filePath);
      return res.status(400).json({
        message: "Unsupported file type",
        allowed: allowedExtensions.join(", "),
      });
    }

    // ---- SECURITY 2: Size limit (15MB) ----
    if (req.file.size > 15 * 1024 * 1024) {
      await fs.unlink(filePath);
      return res.status(400).json({ message: "File too large (max 15MB)" });
    }

    // ---- SECURITY 3: Sanitize filename ----
    const cleanOriginalName = req.file.originalname.replace(/[^\w.-]+/g, "_");

    // ---- BASE URL generation ----
    let BASE = process.env.SERVER_BASE_URL || "";
    BASE = BASE.replace(/\/+$/, ""); // remove ending slash

    const publicUrl = `${BASE}/uploads/${req.file.filename}`;

    return res.status(201).json({
      url: publicUrl,
      fileName: cleanOriginalName,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadedAt: new Date(),
    });
  } catch (err) {
    console.error("uploadFile error:", err);

    // If multer created the file but error happened → delete it
    if (req.file?.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (_) {}
    }

    return res.status(500).json({ message: "Server error while uploading file" });
  }
};
