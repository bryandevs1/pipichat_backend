const { uploadToGoogleCloud } = require("./googleCloud");
const fs = require("node:fs");
const path = require("node:path");

// Check if Google Cloud is available
const isGoogleCloudActive = () => {
  if (!process.env.GOOGLE_CLOUD_BUCKET_NAME || !process.env.GOOGLE_CLOUD_KEYFILE) {
    return false;
  }
  const credentialsPath = path.resolve(process.env.GOOGLE_CLOUD_KEYFILE);
  return fs.existsSync(credentialsPath);
};

// Upload story media (auto-fallback to local)
const uploadStoryMedia = async (file) => {
  const isCloudActive = isGoogleCloudActive();

  if (isCloudActive) {
    try {
      console.log("📤 Uploading to Google Cloud...");
      const result = await uploadToGoogleCloud(file, "stories");

      // Google Cloud returns: { url: "photos/2025/04/...", id: "uploads/photos/2025/04/..." }
      // We need to construct the full URL for frontend
      const publicUrl = `https://storage.googleapis.com/${process.env.GOOGLE_CLOUD_BUCKET_NAME}/${result.url}`;

      return {
        success: true,
        url: publicUrl,
        storage: "google-cloud",
        dbPath: result.url, // Save this for deletion later
      };
    } catch (error) {
      console.error(
        "Google Cloud upload failed, falling back to local:",
        error
      );
      // Fall through to local storage
    }
  }

  // Local storage fallback
  console.log("📁 Uploading to local storage...");
  return await uploadToLocal(file);
};

// Local storage upload
const uploadToLocal = async (file) => {
  const uploadDir = "uploads/stories";

  // Ensure directory exists
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  // Create unique filename
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 8);
  const fileName = `story_${randomString}_${timestamp}${path.extname(
    file.originalname
  )}`;
  const filePath = path.join(uploadDir, fileName);

  // Save file locally
  fs.writeFileSync(filePath, file.buffer);

  // Create public URL
  const baseUrl = process.env.BASE_URL || "http://localhost:5200";
  const publicUrl = `${baseUrl}/uploads/stories/${fileName}`;

  return {
    success: true,
    url: publicUrl,
    storage: "local",
    localPath: filePath,
  };
};

// Delete story media
// utils/fileUpload.js - Add this function
const deleteStoryMedia = async (mediaUrl) => {
  try {
    if (mediaUrl.includes("storage.googleapis.com")) {
      // Google Cloud file
      if (
        !process.env.GOOGLE_CLOUD_BUCKET_NAME ||
        !process.env.GOOGLE_CLOUD_KEYFILE
      ) {
        console.warn("Google Cloud not configured, cannot delete:", mediaUrl);
        return { success: false, error: "Google Cloud not configured" };
      }

      const { Storage } = require("@google-cloud/storage");
      const credentialsPath = path.resolve(process.env.GOOGLE_CLOUD_KEYFILE);
      const storage = new Storage({
        keyFilename: credentialsPath,
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      });

      const bucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME;
      const bucketUrl = `https://storage.googleapis.com/${bucketName}/`;
      const filePath = mediaUrl.replace(bucketUrl, "");

      if (filePath && filePath !== mediaUrl) {
        await storage.bucket(bucketName).file(filePath).delete();
        console.log("✅ Deleted from Google Cloud:", filePath);
        return { success: true, storage: "google-cloud", path: filePath };
      } else {
        return { success: false, error: "Invalid Google Cloud URL" };
      }
    } else if (mediaUrl.includes("/uploads/stories/")) {
      // Local file
      // fs and path already required at top of file
      const urlParts = mediaUrl.split("/");
      const fileName = urlParts[urlParts.length - 1];

      if (fileName) {
        const filePath = path.join(
          __dirname,
          "..",
          "uploads",
          "stories",
          fileName
        );

        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log("✅ Deleted local file:", fileName);
          return { success: true, storage: "local", path: filePath };
        } else {
          return { success: false, error: "File not found locally" };
        }
      } else {
        return { success: false, error: "Invalid local URL" };
      }
    } else {
      return { success: false, error: "Unsupported URL format" };
    }
  } catch (error) {
    console.error("Error deleting file:", error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  uploadStoryMedia,
  deleteStoryMedia,
  isGoogleCloudActive,
};
