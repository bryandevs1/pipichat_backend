// middleware/multer.js
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Ensure uploads directory exists
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Create separate directories for different media types
const mediaDirs = {
  images: path.join(process.cwd(), "uploads", "images"),
  videos: path.join(process.cwd(), "uploads", "videos"),
  voice_notes: path.join(process.cwd(), "uploads", "voice_notes"),
  stories: path.join(process.cwd(), "uploads", "stories"),
};

// Create all directories
Object.values(mediaDirs).forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Determine destination based on file type
    let destDir = mediaDirs.stories; // Default to stories

    if (file.mimetype.startsWith("image/")) {
      destDir = mediaDirs.images;
    } else if (file.mimetype.startsWith("video/")) {
      destDir = mediaDirs.videos;
    } else if (file.mimetype.startsWith("audio/")) {
      destDir = mediaDirs.voice_notes;
    }

    cb(null, destDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || "");

    // Generate appropriate filename prefix
    let prefix = "file";
    if (file.mimetype.startsWith("image/")) {
      prefix = "image";
    } else if (file.mimetype.startsWith("video/")) {
      prefix = "video";
    } else if (file.mimetype.startsWith("audio/")) {
      prefix = "voice";
    }

    cb(null, prefix + "-" + uniqueSuffix + ext);
  },
});

const fileFilter = (req, file, cb) => {
  // Allow images, videos, and audio files
  const allowedMimeTypes = [
    // Images
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    // Videos
    "video/mp4",
    "video/quicktime",
    "video/x-msvideo",
    "video/x-ms-wmv",
    "video/x-flv",
    "video/webm",
    "video/x-matroska",
    "video/3gpp",
    // Audio (voice notes)
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/ogg",
    "audio/m4a",
    "audio/x-m4a",
    "audio/aac",
    "audio/x-aac",
    "audio/webm",
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Invalid file type. Allowed: images, videos, audio files. Got: ${file.mimetype}`,
      ),
      false,
    );
  }
};

const upload = multer({
  storage, // This uses disk storage
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
    files: 1, // Max 1 file at a time
  },
});

module.exports = upload;
