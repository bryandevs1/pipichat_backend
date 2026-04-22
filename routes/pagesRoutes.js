// routes/pages.js
const express = require("express");
const router = express.Router();
const PagesController = require("../controllers/pagesController");
const { authenticateToken } = require("../middleware/authMiddleware");
const multer = require("multer");

const storage = multer.memoryStorage();

// For page creation/update
const pageUpload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 2,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(
        new Error("Only image files are allowed for page pictures/covers!"),
        false,
      );
    }
  },
});

// For posts - comprehensive upload configuration
const postUpload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Allow all common file types for posts
    const allowedMimeTypes = [
      // Images
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/bmp",
      "image/svg+xml",
      // Videos
      "video/mp4",
      "video/mpeg",
      "video/quicktime",
      "video/x-msvideo",
      "video/x-matroska",
      "video/x-flv",
      "video/webm",
      "video/3gpp",
      "video/x-ms-wmv",
      // Audio
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/ogg",
      "audio/aac",
      "audio/flac",
      "audio/x-m4a",
      "audio/webm",
      // Documents
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/zip",
      "application/x-rar-compressed",
      "application/x-7z-compressed",
      "application/x-tar",
      "application/gzip",
      // Text
      "text/plain",
      "text/html",
      "text/css",
      "text/javascript",
      "application/json",
      "application/xml",
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed.`), false);
    }
  },
});

// Apply authentication middleware to all routes
router.use(authenticateToken);

// Error handling middleware for multer
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: `File upload error: ${err.message}`,
    });
  } else if (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
  next();
});

// ✅ SPECIFIC ROUTES FIRST
router.get("/user/:userId?", PagesController.getUserPages);
router.get("/categories", PagesController.getPageCategories);
router.get("/search", PagesController.searchPages);
router.get("/countries", PagesController.getCountries);
router.get("/report-categories", PagesController.getReportCategories);

// ✅ PAGE MANAGEMENT ROUTES
// Create page
router.post(
  "/",
  pageUpload.fields([
    { name: "page_picture", maxCount: 1 },
    { name: "page_cover", maxCount: 1 },
  ]),
  PagesController.createPage,
);

// Get page details
router.get("/:pageId", PagesController.getPage);

// Update page
router.put(
  "/:pageId",
  pageUpload.fields([
    { name: "page_picture", maxCount: 1 },
    { name: "page_cover", maxCount: 1 },
  ]),
  PagesController.updatePage,
);

// Delete page
router.delete("/:pageId", PagesController.deletePage);

// ✅ PAGE LIKES ROUTES
// Like/unlike page
router.post("/:pageId/like", PagesController.toggleLikePage);

// Get page likers
router.get("/:pageId/likers", PagesController.getPageLikers);

// ✅ PAGE ADMIN MANAGEMENT
// Get page admins
router.get("/:pageId/admins", PagesController.getPageAdmins);

// Add page admin
router.post("/:pageId/admins", PagesController.addPageAdmin);

// Remove page admin
router.delete("/:pageId/admins/:adminId", PagesController.removePageAdmin);

// ✅ PAGE INVITES
// Invite user to page
router.post("/:pageId/invite", PagesController.inviteToPage);

// Get page invites
router.get("/:pageId/invites", PagesController.getPageInvites);

// Cancel page invite
router.delete("/:pageId/invites/:inviteId", PagesController.cancelPageInvite);

// ✅ PAGE STATISTICS
router.get("/:pageId/stats", PagesController.getPageStats);

// ✅ PAGE BOOSTING
router.post("/:pageId/boost", PagesController.boostPage);
router.post("/:pageId/unboost", PagesController.unboostPage);

// ✅ PAGE REPORTING
router.post("/:pageId/report", PagesController.reportPage);

// ✅ PAGE POSTS - COMPLETE ROUTES
// Get page posts
router.get("/:pageId/posts", PagesController.getPagePosts);

// Get single post (could also use posts/:postId route if you have a separate posts router)
router.get("/:pageId/posts/:postId", PagesController.getPagePost);

// Create page post (supports all post types)
router.post(
  "/:pageId/posts",
  postUpload.fields([
    { name: "photos", maxCount: 20 },
    { name: "videos", maxCount: 10 },
    { name: "files", maxCount: 10 },
    { name: "cover", maxCount: 1 },
    { name: "cover_image", maxCount: 1 },
    { name: "product_images", maxCount: 20 },
    { name: "audio", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
  ]),
  PagesController.createPagePost,
);

// Update page post
router.put(
  "/:pageId/posts/:postId",
  postUpload.fields([
    { name: "photos", maxCount: 20 },
    { name: "cover", maxCount: 1 },
  ]),
  PagesController.updatePagePost,
);

// Delete page post
router.delete("/:pageId/posts/:postId", PagesController.deletePagePost);

// Pin/unpin post
router.post("/:pageId/posts/:postId/pin", PagesController.togglePinPost);

// Get pinned post
router.get("/:pageId/pinned-post", PagesController.getPinnedPost);

// ✅ POST INTERACTIONS (could also be in separate posts router)
// React to post
router.post("/:pageId/posts/:postId/react", PagesController.reactToPost);

// Remove reaction from post
router.delete(
  "/:pageId/posts/:postId/react",
  PagesController.removeReactionFromPost,
);

// Comment on post
router.post(
  "/:pageId/posts/:postId/comments",
  postUpload.fields([
    { name: "image", maxCount: 1 },
    { name: "voice_note", maxCount: 1 },
  ]),
  PagesController.commentOnPost,
);

// Add these to your routes file

// Delete comment
router.delete(
  "/:pageId/posts/:postId/comments/:commentId",
  PagesController.deleteComment,
);

// React to comment
router.post(
  "/:pageId/posts/:postId/comments/:commentId/react",
  PagesController.reactToComment,
);

// Get post comments
router.get("/:pageId/posts/:postId/comments", PagesController.getPostComments);

// Get post reactions
router.get(
  "/:pageId/posts/:postId/reactions",
  PagesController.getPostReactions,
);

// Get post shares
router.get("/:pageId/posts/:postId/shares", PagesController.getPostShares);

// Save/unsave post
router.post("/:pageId/posts/:postId/save", PagesController.toggleSavePost);

// Share post
router.post("/:pageId/posts/:postId/share", PagesController.sharePost);

// ✅ ADDITIONAL POST-RELATED ROUTES
// Get blog categories for article posts
router.get("/posts/categories/blogs", PagesController.getBlogCategories);

// Get job categories for job posts
router.get("/posts/categories/jobs", PagesController.getJobCategories);

// Get market categories for product posts
router.get("/posts/categories/market", PagesController.getMarketCategories);

// Get offers categories for offer posts
router.get("/posts/categories/offers", PagesController.getOffersCategories);

// Get colored patterns
router.get("/posts/colored-patterns", PagesController.getColoredPatterns);

// Get system reactions
router.get("/posts/system-reactions", PagesController.getSystemReactions);

// Get user's saved posts
router.get("/posts/saved", PagesController.getSavedPosts);

// ✅ CATCH-ALL ERROR HANDLER
router.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Page route not found",
  });
});

module.exports = router;
