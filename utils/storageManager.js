/// utils/storageManager.js
const { Storage } = require("@google-cloud/storage");
const path = require("node:path");
const crypto = require("crypto");
const stream = require("node:stream");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsPromises = require("node:fs").promises;
const os = require("node:os");

class StorageManager {
  constructor() {
    // ✅ Use absolute path for credentials file
    const credentialsPath = process.env.GOOGLE_CLOUD_KEYFILE
      ? path.resolve(process.env.GOOGLE_CLOUD_KEYFILE)
      : null;

    // ✅ Validate credentials file exists
    if (credentialsPath && !fs.existsSync(credentialsPath)) {
      console.error(
        "❌ Google Cloud credentials file not found at:",
        credentialsPath,
      );
      console.error("Current working directory:", process.cwd());
      throw new Error(
        `Google Cloud credentials file not found: ${credentialsPath}`,
      );
    }

    console.log("✅ Google Cloud credentials loaded from:", credentialsPath);

    // ✅ Log credentials details for debugging
    if (credentialsPath && fs.existsSync(credentialsPath)) {
      try {
        const credsContent = fs.readFileSync(credentialsPath, "utf8");
        const creds = JSON.parse(credsContent);
        console.log("📋 Google Cloud Configuration:");
        console.log("   Service Account:", creds.client_email);
        console.log("   Project ID:", creds.project_id);
        console.log("   Key ID:", creds.private_key_id);
        console.log("   Key Type:", creds.type);
        console.log("   Private Key Length:", creds.private_key?.length || 0);
        console.log(
          "   Private Key Valid Format:",
          creds.private_key?.includes("BEGIN PRIVATE KEY") &&
            creds.private_key?.includes("END PRIVATE KEY"),
        );
      } catch (e) {
        console.error("⚠️ Failed to parse credentials file:", e.message);
      }
    }

    // Initialize Google Cloud
    try {
      this.gcsStorage = new Storage({
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
        keyFilename: credentialsPath,
      });
      this.gcsBucket = this.gcsStorage.bucket(
        process.env.GOOGLE_CLOUD_BUCKET_NAME,
      );
      console.log(
        `📁 Storage: Google Cloud - Bucket: ${process.env.GOOGLE_CLOUD_BUCKET_NAME}`,
      );
    } catch (error) {
      console.error(
        "❌ Failed to initialize Google Cloud Storage:",
        error.message,
      );
      console.error("   Details:", error.toString());
      throw error;
    }
  }

  /**
   * Upload file and return PATH only (not full URL in DB)
   * @param {Object} file - Multer file object (has buffer or path)
   * @param {String} folder - Folder name
   * @returns {Object} { path, storage_type, storage_data, public_url }
   */
  async upload(file, folder = "stories") {
    console.log(`📤 Uploading to Google Cloud...`, {
      filename: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
      hasBuffer: !!file.buffer,
      bufferSize: file.buffer?.length,
      hasPath: !!file.path,
    });

    const startTime = Date.now();

    // Ensure file has required properties
    const fileToUpload = {
      ...file,
      mimetype: file.mimetype || this.getMimeType(file.originalname),
    };

    // Generate unique name like googleCloud utility
    const currentYear = new Date().getFullYear();
    const currentMonth = String(new Date().getMonth() + 1).padStart(2, "0");
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 8);
    const uniqueName = `pipiafrica_${randomString}_${timestamp}_${file.originalname}`;

    try {
      const result = await this.uploadToGoogleCloud(
        fileToUpload,
        folder,
        currentYear,
        currentMonth,
        uniqueName,
      );
      console.log(
        `✅ Successfully uploaded to Google Cloud in ${
          Date.now() - startTime
        }ms`,
      );
      return result;
    } catch (error) {
      console.error(`❌ Upload failed:`, error.message);
      console.error("📋 Full Error Details:");
      console.error("   Error Name:", error.name);
      console.error("   Error Code:", error.code);
      console.error("   Error Status:", error.status);
      console.error("   Error Message:", error.message);
      if (error.response?.data) {
        console.error("   Response Data:", JSON.stringify(error.response.data));
      }
      if (error.config) {
        console.error("   Config URL:", error.config.url);
        console.error("   Config Method:", error.config.method);
      }
      console.error("   Full Stack:", error.stack);
      throw error;
    }
  }

  async uploadToGoogleCloud(file, folder, year, month, uniqueName) {
    const directoryPath = `${folder}/${year}/${month}`;
    const storagePath = `${directoryPath}/${uniqueName}`;

    console.log(`📊 uploadToGoogleCloud Details:`);
    console.log(`   Storage Path: ${storagePath}`);
    console.log(`   Bucket: ${process.env.GOOGLE_CLOUD_BUCKET_NAME}`);
    console.log(`   File Size: ${file.size} bytes`);

    // Create a readable stream from buffer or file path
    let fileStream;

    if (file.buffer) {
      // Create stream from buffer
      const bufferStream = new stream.PassThrough();
      bufferStream.end(file.buffer);
      fileStream = bufferStream;
      console.log(`   Using buffer stream`);
    } else if (file.path) {
      // Create stream from file path
      fileStream = fs.createReadStream(file.path);
      console.log(`   Using file stream from: ${file.path}`);
    } else {
      throw new Error("File must have either buffer or path property");
    }

    // Upload to GCS
    return await new Promise((resolve, reject) => {
      console.log(`🚀 Starting write stream to Google Cloud...`);

      const writeStream = this.gcsBucket.file(storagePath).createWriteStream({
        metadata: {
          contentType: file.mimetype,
        },
        resumable: false,
      });

      // Track upload progress
      let uploadedBytes = 0;
      fileStream.on("data", (chunk) => {
        uploadedBytes += chunk.length;
        console.log(`   Uploaded: ${uploadedBytes} / ${file.size} bytes`);
      });

      fileStream
        .pipe(writeStream)
        .on("error", (error) => {
          console.error(`❌ Write stream error:`, error.message);
          console.error(`   Error Code: ${error.code}`);
          console.error(`   Error Status: ${error.status}`);
          console.error(`   Full Error:`, error);
          reject(error);
        })
        .on("finish", () => {
          console.log(`✅ Upload completed successfully`);

          // Return relative path for database storage (remove uploads/ prefix like googleCloud utility)
          const dbPath = storagePath.replace(/^uploads\//, ""); // e.g., "photos/2025/04/..."
          const result = {
            url: dbPath,
            path: dbPath,
            id: storagePath,
            storage_type: "google-cloud",
            storage_data: JSON.stringify({
              bucket: process.env.GOOGLE_CLOUD_BUCKET_NAME,
              filename: uniqueName,
              size: file.size,
              mime_type: file.mimetype,
              uploaded_at: new Date().toISOString(),
            }),
            public_url: `https://storage.googleapis.com/${process.env.GOOGLE_CLOUD_BUCKET_NAME}/${storagePath}`,
            thumbnail_url: null,
            filename: uniqueName,
          };
          resolve(result);
        });
    });
  }

  getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".mp4": "video/mp4",
      ".mov": "video/quicktime",
      ".avi": "video/x-msvideo",
      ".wmv": "video/x-ms-wmv",
      ".flv": "video/x-flv",
      ".webm": "video/webm",
      ".mkv": "video/x-matroska",
      ".3gp": "video/3gpp",
    };
    return mimeTypes[ext] || "application/octet-stream";
  }

  /**
   * Generate thumbnail for video
   * @param {Object} videoFile - Video file object with buffer or path
   * @returns {Object} Thumbnail upload result
   */
  async generateThumbnail(videoFile) {
    try {
      console.log("🎞️ Generating thumbnail for video...");

      // Check if ffmpeg is available
      const hasFFmpeg = await this.checkFFmpeg();
      if (!hasFFmpeg) {
        console.warn(
          "⚠️ FFmpeg not available. Using video frame extraction fallback.",
        );
        return await this.extractFirstFrameFallback(videoFile);
      }

      const thumbnailName = `thumb-${Date.now()}.jpg`;
      const thumbnailPath = path.join(os.tmpdir(), thumbnailName);

      // Create video input source
      let videoSource;
      let shouldDeleteTempVideo = false;

      if (videoFile.buffer) {
        // Write buffer to temp file
        const tempVideoPath = path.join(os.tmpdir(), `video-${Date.now()}.mp4`);
        await fsPromises.writeFile(tempVideoPath, videoFile.buffer);
        videoSource = tempVideoPath;
        shouldDeleteTempVideo = true;
      } else if (videoFile.path) {
        videoSource = videoFile.path;
      } else {
        throw new Error("Video file must have buffer or path");
      }

      // Generate thumbnail using ffmpeg
      const thumbnailBuffer = await this.extractFrameWithFFmpeg(
        videoSource,
        thumbnailPath,
      );

      // Clean up temp video file if we created one
      if (shouldDeleteTempVideo) {
        try {
          await fsPromises.unlink(videoSource);
        } catch (e) {
          console.warn("Failed to delete temp video file:", e.message);
        }
      }

      // Upload thumbnail
      const thumbnailResult = await this.upload(
        {
          buffer: thumbnailBuffer,
          originalname: thumbnailName,
          mimetype: "image/jpeg",
          size: thumbnailBuffer.length,
        },
        "video-thumbnails",
      );

      // Clean up temp thumbnail file
      try {
        await fsPromises.unlink(thumbnailPath);
      } catch (e) {
        console.warn("Failed to delete temp thumbnail file:", e.message);
      }

      console.log("✅ Thumbnail generated successfully");
      return thumbnailResult;
    } catch (error) {
      console.error("❌ Thumbnail generation failed:", error.message);

      // Fallback: Return the video as thumbnail (or a default)
      try {
        return await this.createDefaultThumbnail(videoFile);
      } catch (fallbackError) {
        console.error(
          "❌ Fallback thumbnail also failed:",
          fallbackError.message,
        );
        return this.getDefaultThumbnailResult();
      }
    }
  }

  /**
   * Check if ffmpeg is available
   */
  async checkFFmpeg() {
    return new Promise((resolve) => {
      const ffmpeg = spawn("ffmpeg", ["-version"]);

      ffmpeg.on("error", () => {
        resolve(false);
      });

      ffmpeg.on("close", (code) => {
        resolve(code === 0);
      });

      // Timeout after 3 seconds
      setTimeout(() => {
        ffmpeg.kill();
        resolve(false);
      }, 3000);
    });
  }

  /**
   * Extract frame using FFmpeg
   */
  async extractFrameWithFFmpeg(videoSource, outputPath) {
    return new Promise((resolve, reject) => {
      const args = [
        "-i",
        videoSource,
        "-ss",
        "00:00:01", // Seek to 1 second
        "-vframes",
        "1", // Extract 1 frame
        "-vf",
        "scale=640:-1", // Resize to 640px width
        "-q:v",
        "2", // Quality (1-31, lower is better)
        "-f",
        "image2",
        outputPath,
      ];

      console.log("Running ffmpeg with args:", args);

      const ffmpeg = spawn("ffmpeg", args);

      let stderr = "";
      ffmpeg.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      ffmpeg.on("close", async (code) => {
        if (code === 0) {
          try {
            const buffer = await fsPromises.readFile(outputPath);
            resolve(buffer);
          } catch (readError) {
            reject(new Error(`Failed to read thumbnail: ${readError.message}`));
          }
        } else {
          reject(
            new Error(
              `FFmpeg failed with code ${code}: ${stderr.substring(0, 200)}`,
            ),
          );
        }
      });

      ffmpeg.on("error", (err) => {
        reject(new Error(`FFmpeg process error: ${err.message}`));
      });
    });
  }

  /**
   * Fallback method if ffmpeg is not available
   */
  async extractFirstFrameFallback(videoFile) {
    console.log("Using fallback thumbnail extraction");

    // For now, create a simple colored thumbnail
    // You could also use a library like jimp or sharp to create a thumbnail
    const { createCanvas } = require("canvas");

    const canvas = createCanvas(640, 360);
    const ctx = canvas.getContext("2d");

    // Create a gradient background
    const gradient = ctx.createLinearGradient(0, 0, 640, 360);
    gradient.addColorStop(0, "#3498db");
    gradient.addColorStop(1, "#2c3e50");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 640, 360);

    // Add play icon
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.beginPath();
    ctx.moveTo(280, 130);
    ctx.lineTo(280, 230);
    ctx.lineTo(380, 180);
    ctx.closePath();
    ctx.fill();

    // Add text
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 24px Arial";
    ctx.textAlign = "center";
    ctx.fillText("VIDEO", 320, 300);

    const buffer = canvas.toBuffer("image/jpeg");

    return await this.upload(
      {
        buffer,
        originalname: `fallback-thumb-${Date.now()}.jpg`,
        mimetype: "image/jpeg",
        size: buffer.length,
      },
      "video-thumbnails",
    );
  }

  /**
   * Create default thumbnail from video file
   */
  async createDefaultThumbnail(videoFile) {
    // Use the video file itself as thumbnail (stores as image)
    return await this.upload(
      {
        ...videoFile,
        originalname:
          videoFile.originalname.replace(/\.[^/.]+$/, "") + "-thumb.jpg",
        mimetype: "image/jpeg",
      },
      "video-thumbnails",
    );
  }

  /**
   * Get default thumbnail result
   */
  getDefaultThumbnailResult() {
    return {
      path: "default/video-thumbnail.jpg",
      storage_type: "google-cloud",
      storage_data: JSON.stringify({
        is_default: true,
        generated_at: new Date().toISOString(),
      }),
      public_url: this.getDefaultThumbnailUrl(),
      thumbnail_url: this.getDefaultThumbnailUrl(),
      filename: "default-video-thumbnail.jpg",
    };
  }

  /**
   * Get default thumbnail URL
   */
  getDefaultThumbnailUrl() {
    return `https://storage.googleapis.com/${process.env.GOOGLE_CLOUD_BUCKET_NAME}/default/video-thumbnail.jpg`;
  }

  /**
   * Get public URL from stored path and storage type
   * @param {string} storageType
   * @param {string} path
   * @param {string} [storageData=null] - JSON string from DB
   */
  getPublicUrl(storageType, path, storageData = null) {
    if (storageType === "google-cloud") {
      return `https://storage.googleapis.com/${process.env.GOOGLE_CLOUD_BUCKET_NAME}/${path}`;
    }
    throw new Error(`Unknown storage type: ${storageType}`);
  }

  /**
   * Delete file from storage
   */
  async deleteFile(storageType, path, storageData = null) {
    try {
      if (storageType === "google-cloud") {
        await this.gcsBucket.file(path).delete();
        return true;
      }
      console.warn(`Unknown storage type for deletion: ${storageType}`);
      return false;
    } catch (error) {
      console.error(`Error deleting from ${storageType}:`, error.message);
      return false;
    }
  }

  /**
   * Check if file is a video
   */
  isVideoFile(mimeType) {
    const videoMimes = [
      "video/mp4",
      "video/quicktime",
      "video/x-msvideo",
      "video/x-ms-wmv",
      "video/x-flv",
      "video/webm",
      "video/x-matroska",
      "video/3gpp",
    ];
    return videoMimes.includes(mimeType);
  }

  /**
   * Check if file is an image
   */
  isImageFile(mimeType) {
    const imageMimes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/svg+xml",
    ];
    return imageMimes.includes(mimeType);
  }

  /**
   * Diagnostic: Test Google Cloud authentication
   */
  async testAuthentication() {
    console.log("\n🔧 === Google Cloud Storage Authentication Test ===");
    try {
      console.log("Testing bucket access...");
      await this.gcsBucket.getFiles({ maxResults: 1 });
      console.log(`✅ Authentication successful! Bucket is accessible.`);
      console.log(`📊 Bucket info: ${process.env.GOOGLE_CLOUD_BUCKET_NAME}`);
      return { success: true };
    } catch (error) {
      console.error(`❌ Authentication test failed!`);
      console.error(`   Error Name: ${error.name}`);
      console.error(`   Error Code: ${error.code}`);
      console.error(`   Error Status: ${error.status}`);
      console.error(`   Error Message: ${error.message}`);
      if (error.response?.data) {
        console.error(`   Response Data:`, error.response.data);
      }
      return { success: false, error: error.message };
    }
  }
}

module.exports = new StorageManager();
