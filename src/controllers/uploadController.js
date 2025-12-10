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
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const filePath = req.file.path;
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    const mime = req.file.mimetype;

    // -------------------------------
    // 1️⃣ VALIDATE EXTENSION + MIME
    // -------------------------------
    if (!allowedExtensions.includes(fileExt) || !allowedMime.includes(mime)) {
      await fs.unlink(filePath); // delete invalid file
      return res.status(400).json({
        message: "Unsupported file type",
        allowed: allowedExtensions.join(", "),
      });
    }

    // -------------------------------
    // 2️⃣ FILE SIZE LIMIT (15MB)
    // -------------------------------
    if (req.file.size > 15 * 1024 * 1024) {
      await fs.unlink(filePath);
      return res.status(400).json({ message: "File too large (max 15MB)" });
    }

    // -------------------------------
    // 3️⃣ SANITIZE FILE NAME
    // -------------------------------
    const cleanOriginalName = req.file.originalname.replace(/[^\w.-]+/g, "_");

    // -------------------------------
    // 4️⃣ BUILD PUBLIC URL
    // -------------------------------
    let BASE = process.env.SERVER_BASE_URL || "";
    BASE = BASE.replace(/\/+$/, ""); // remove trailing slash

    const fileUrl = `${BASE}/uploads/${req.file.filename}`;

    // -------------------------------
    // 5️⃣ RESPONSE FORMAT (Matches Flutter expectations)
    // -------------------------------
    return res.status(201).json({
      fileUrl,
      fileName: cleanOriginalName,
      mimeType: mime,
      size: req.file.size,
      uploadedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error("uploadFile error:", err);

    // Remove created file if error happens
    if (req.file?.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (_) {}
    }

    return res.status(500).json({ message: "Server error while uploading file" });
  }
};
