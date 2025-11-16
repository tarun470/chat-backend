import path from "path";
import fs from "fs";

export const uploadFile = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    // ensure /uploads exists at project root
    const publicUrl = `${process.env.SERVER_BASE_URL || ""}/uploads/${req.file.filename}`;

    // return metadata expected by frontend
    return res.status(201).json({
      url: publicUrl,
      fileName: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype,
    });
  } catch (err) {
    console.error("uploadFile error:", err);
    return res.status(500).json({ message: err.message });
  }
};
