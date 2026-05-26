const fs = require("node:fs");
const path = require("node:path");

const isGoogleCloudActive = () => {
  if (!process.env.GOOGLE_CLOUD_BUCKET_NAME || !process.env.GOOGLE_CLOUD_KEYFILE || !process.env.GOOGLE_CLOUD_PROJECT_ID) {
    return false;
  }
  const credentialsPath = path.resolve(process.env.GOOGLE_CLOUD_KEYFILE);
  return fs.existsSync(credentialsPath);
};

module.exports = { isGoogleCloudActive };
