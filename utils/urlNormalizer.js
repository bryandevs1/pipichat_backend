/**
 * Normalize media URLs for consistent display
 * Handles:
 * - Relative paths (uploads/images/file.jpg)
 * - Full paths with cwd prefix
 * - Google Cloud Storage URLs
 */

const getFullUserProfileUrl = (pictureUrl) => {
  if (!pictureUrl) return null;

  const API_BASE = process.env.BASE_URL || "https://server.pipiafrica.com";

  // If it's already a full URL (http/https or Google Storage), return as is
  if (pictureUrl.startsWith("http://") || pictureUrl.startsWith("https://")) {
    return pictureUrl;
  }

  // If it's a relative path, prepend the API base
  return `${API_BASE}${pictureUrl}`;
};

const getFullMediaUrl = (mediaUrl) => {
  if (!mediaUrl) return null;

  const API_BASE = process.env.BASE_URL || "https://server.pipiafrica.com";

  // If it's already a full URL (http/https or Google Storage), return as is
  if (mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://")) {
    return mediaUrl;
  }

  // If it's a relative path, prepend the API base
  return `${API_BASE} ${mediaUrl}`;
};

module.exports = {
  getFullUserProfileUrl,
  getFullMediaUrl,
};
