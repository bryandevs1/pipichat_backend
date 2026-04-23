// routes/postRoutes.js
const express = require("express");
const router = express.Router();
const postController = require("../controllers/postController");
const { authenticateToken } = require("../middleware/authMiddleware");
const { authenticateUser } = require("../controllers/friendsController");
const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "video/mp4",
      "video/quicktime",
      "audio/mpeg",
      "audio/mp4",
      "audio/wav",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    cb(null, allowed.includes(file.mimetype));
  },
});

// ─── NOTE: Specific routes MUST come before parameterized routes ──────────────
// e.g. /comments/:commentId must be defined BEFORE /:id/comments
// otherwise Express will try to match 'comments' as a post ID

// ==================== COMMENT-LEVEL ROUTES (no post ID prefix) ====================
// These must be defined BEFORE /:id routes to avoid conflict
router.post(
  "/comments/:commentId/react",
  authenticateToken,
  postController.reactToComment,
);
router.delete(
  "/comments/:commentId",
  authenticateToken,
  postController.deleteComment,
);

router.get(
  "/offers/categories",
  authenticateToken,
  postController.getOfferCategories,
);
// ==================== FEED & UTILITY ====================
router.get("/feed", authenticateToken, postController.getFeedPosts);
router.get("/feed/filters", authenticateToken, postController.getFeedFilters);

// ==================== REPORT ====================
// NOTE: Must be defined BEFORE /:id routes to avoid matching "report" as post ID
router.post("/report", authenticateToken, postController.reportPost);

// ==================== CREATE POST ====================
router.post(
  "/",
  authenticateToken,
  upload.fields([
    { name: "photos", maxCount: 20 },
    { name: "videos", maxCount: 5 },
    { name: "cover", maxCount: 1 }, // articles
    { name: "cover_image", maxCount: 1 }, // funding, jobs
    { name: "product_images", maxCount: 10 },
    { name: "thumbnail", maxCount: 1 }, // live
    { name: "audio", maxCount: 1 },
    { name: "files", maxCount: 10 },
    { name: "media", maxCount: 1 },
    { name: "video", maxCount: 1 },
  ]),
  postController.createPost,
);

// ==================== USER POST ROUTES ====================
router.get(
  "/users/:id/count",
  authenticateUser,
  postController.getUserPostCount,
);
router.get("/users/:id", authenticateUser, postController.getUserPosts);

// ==================== POST VIEW ====================
// NOTE: Removed duplicate route (was defined twice in original)
router.post("/view/:postId", authenticateToken, postController.recordPostView);
router.get("/categories", authenticateToken, postController.getCategories);
router.get(
  "/colored-patterns",
  authenticateToken,
  postController.getColoredPatterns,
);

// ==================== SINGLE POST ====================
router.get("/:id", authenticateToken, postController.getPost);

// ==================== REACTIONS ====================
router.post("/:id/react", authenticateToken, postController.reactToPost);

// ==================== COMMENTS ====================
router.get("/:id/comments", authenticateToken, postController.getPostComments);
router.post(
  "/:id/comments",
  authenticateToken,
  upload.single("media"),
  postController.createComment,
);

// ==================== POLL ====================
router.get("/:id/poll", authenticateToken, postController.getPoll);
router.post("/:id/poll/vote", authenticateToken, postController.voteInPoll);
router.get(
  "/:id/poll/results",
  authenticateToken,
  postController.getPollResults,
);

// ==================== JOB ====================
router.post(
  "/:id/job/apply",
  authenticateToken,
  upload.single("cv"),
  postController.applyForJob,
);
router.get(
  "/:id/job/applications",
  authenticateToken,
  postController.getJobApplications,
);

// ==================== FUNDING ====================
router.post(
  "/:id/funding/donate",
  authenticateToken,
  postController.donateToFunding,
);
router.get(
  "/:id/funding/donors",
  authenticateToken,
  postController.getFundingDonors,
);

// ==================== PRODUCT ====================
router.post(
  "/:id/product/purchase",
  authenticateToken,
  postController.purchaseProduct,
);

// ==================== BOOST ====================
router.post("/:id/boost", authenticateToken, postController.boostPost);

router.delete("/:id", authenticateToken, postController.deletePost);
// ==================== SAVE / SHARE ====================
router.post("/:id/save", authenticateToken, postController.savePost);
router.post("/:id/share", authenticateToken, postController.sharePost);

module.exports = router;
