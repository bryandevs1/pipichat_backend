const { Storage } = require("@google-cloud/storage");
const crypto = require("crypto");
const path = require("node:path");
const fs = require("node:fs");

// ✅ Use absolute path for credentials file
const credentialsPath = process.env.GOOGLE_CLOUD_KEYFILE 
  ? path.resolve(process.env.GOOGLE_CLOUD_KEYFILE)
  : null;

// ✅ Validate credentials file exists
if (credentialsPath && !fs.existsSync(credentialsPath)) {
  console.error("❌ Google Cloud credentials file not found at:", credentialsPath);
  console.error("Current working directory:", process.cwd());
  throw new Error(`Google Cloud credentials file not found: ${credentialsPath}`);
}

console.log("✅ Google Cloud credentials loaded from:", credentialsPath);

const storage = new Storage({
  keyFilename: credentialsPath,
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
});

const bucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME;

async function uploadToGoogleCloud(file, directory) {
  const currentYear = new Date().getFullYear();
  const currentMonth = String(new Date().getMonth() + 1).padStart(2, "0");

  const directoryPath = `${directory}/${currentYear}/${currentMonth}`;

  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 8);
  const fileName = `pipiafrca_${randomString}_${timestamp}_${file.originalname}`;

  const fullPath = `${directoryPath}/${fileName}`;
  const bucket = storage.bucket(bucketName);
  const blob = bucket.file(fullPath);

  const blobStream = blob.createWriteStream({
    resumable: false,
    contentType: file.mimetype,
  });

  return new Promise((resolve, reject) => {
    blobStream.on("finish", () => {
      // ✅ Return relative path for database storage
      const dbPath = fullPath.replace(/^uploads\//, ""); // e.g., "photos/2025/03/..."
      resolve({ url: dbPath, id: fullPath }); // `url` for DB, `id` is full path
    });

    blobStream.on("error", reject);
    blobStream.end(file.buffer);
  });
}

module.exports = { uploadToGoogleCloud };
