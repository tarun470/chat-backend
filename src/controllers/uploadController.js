import path from "path";
import fs from "fs";

export const uploadFile = async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ message: "No file uploaded" });

    // ----- SECURITY CHECKS -----
    const allowedTypes = [
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

    if (!allowedTypes.includes(req.file.mimetype)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: "Unsupported file type" });
    }

    if (req.file.size > 15 * 1024 * 1024) {
      // 15MB max
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: "File too large" });
    }

    // ----- URL GENERATION -----
    const BASE = process.env.SERVER_BASE_URL || "";

    const publicUrl = `${BASE}/uploads/${req.file.filename}`;

    return res.status(201).json({
      url: publicUrl,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadedAt: new Date(),
    });
  } catch (err) {
    console.error("uploadFile error:", err);
    return res.status(500).json({ message: err.message });
  }
};

