#!/usr/bin/env node

/**
 * Google Cloud Storage Diagnostic Test
 * Run with: node backend/utils/testGoogleCloud.js
 */

require("dotenv").config();
const path = require("node:path");
const fs = require("node:fs");
const { Storage } = require("@google-cloud/storage");

console.log("\n🔧 === Google Cloud Storage Diagnostic Test ===\n");

// 1. Check environment variables
console.log("📋 Step 1: Environment Variables");
console.log(
  "   GOOGLE_CLOUD_PROJECT_ID:",
  process.env.GOOGLE_CLOUD_PROJECT_ID || "❌ NOT SET",
);
console.log(
  "   GOOGLE_CLOUD_BUCKET_NAME:",
  process.env.GOOGLE_CLOUD_BUCKET_NAME || "❌ NOT SET",
);
console.log(
  "   GOOGLE_CLOUD_KEYFILE:",
  process.env.GOOGLE_CLOUD_KEYFILE || "❌ NOT SET",
);

// 2. Check credentials file exists
console.log("\n📋 Step 2: Credentials File");
const keyfilePath = process.env.GOOGLE_CLOUD_KEYFILE
  ? path.resolve(process.env.GOOGLE_CLOUD_KEYFILE)
  : null;

console.log("   Resolved Path:", keyfilePath);
if (!keyfilePath) {
  console.error("   ❌ GOOGLE_CLOUD_KEYFILE not set");
  process.exit(1);
}

if (!fs.existsSync(keyfilePath)) {
  console.error("   ❌ File not found at path:", keyfilePath);
  process.exit(1);
}
console.log("   ✅ File exists");

// 3. Validate credentials file format
console.log("\n📋 Step 3: Credentials File Validation");
try {
  const credsContent = fs.readFileSync(keyfilePath, "utf8");
  const creds = JSON.parse(credsContent);

  console.log("   ✅ Valid JSON");
  console.log("   Type:", creds.type);
  console.log("   Project ID:", creds.project_id);
  console.log("   Service Account:", creds.client_email);
  console.log("   Private Key ID:", creds.private_key_id);
  console.log(
    "   Private Key Format:",
    creds.private_key?.slice(0, 30) + "...",
  );
  console.log(
    "   Private Key Has BEGIN:",
    creds.private_key?.includes("BEGIN PRIVATE KEY"),
  );
  console.log(
    "   Private Key Has END:",
    creds.private_key?.includes("END PRIVATE KEY"),
  );
  console.log("   Private Key Length:", creds.private_key?.length);
} catch (error) {
  console.error("   ❌ Invalid JSON:", error.message);
  process.exit(1);
}

// 4. Test Storage initialization
console.log("\n📋 Step 4: Google Cloud Storage Initialization");
let storage;
try {
  storage = new Storage({
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    keyFilename: keyfilePath,
  });
  console.log("   ✅ Storage object created");
} catch (error) {
  console.error("   ❌ Failed to create Storage object:", error.message);
  process.exit(1);
}

// 5. Test bucket access
console.log("\n📋 Step 5: Bucket Access");
const bucket = storage.bucket(process.env.GOOGLE_CLOUD_BUCKET_NAME);

(async () => {
  try {
    console.log("   🔄 Testing bucket.getFiles()...");
    const [files] = await bucket.getFiles({ maxResults: 1 });
    console.log("   ✅ Bucket accessible!");
    console.log("   📊 Bucket exists with", files.length, "file(s)");
    console.log("\n✅ === All Tests Passed! ===\n");
  } catch (error) {
    console.error("   ❌ Bucket access failed!");
    console.error("   Error Name:", error.name);
    console.error("   Error Code:", error.code);
    console.error("   Error Status:", error.status);
    console.error("   Error Message:", error.message);
    if (error.response?.data) {
      console.error(
        "   Response Data:",
        JSON.stringify(error.response.data, null, 2),
      );
    }
    if (error.response?.config?.url) {
      console.error("   Request URL:", error.response.config.url);
    }
    console.error("\n❌ === Authentication Failed ===\n");
    process.exit(1);
  }
})();
