const express = require("express");
const router = express.Router();
const GroupController = require("../controllers/groupController");
const { authenticateToken } = require("../middleware/authMiddleware");
const multer = require("multer");

const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // Increased to 50MB for videos
  },
  fileFilter: (req, file, cb) => {
    // Allow images and videos
    if (
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("video/")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only image and video files are allowed!"), false);
    }
  },
});

// For posts specifically - allow multiple file types
const postUpload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB for videos
    files: 10, // Max number of files
  },
  fileFilter: (req, file, cb) => {
    // Allow images, videos, and common document types
    const allowedMimeTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "video/mp4",
      "video/mpeg",
      "video/quicktime",
      "video/x-msvideo",
      "video/x-matroska",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `File type ${file.mimetype} not allowed. Only images, videos, and documents are allowed.`
        ),
        false
      );
    }
  },
});

router.use(authenticateToken);

// Add this right after router.use(authenticateToken);
router.use((req, res, next) => {
  const oldJson = res.json;
  res.json = function (data) {
    return oldJson.call(this, data);
  };

  next();
});

// ✅ REORDERED: Specific routes FIRST
router.get("/user/deleted-groups", GroupController.getDeletedGroups);
router.get("/user/:userId?", GroupController.getUserGroups); // This comes before /:groupId

// Public routes (these come before parameterized routes too)
router.get("/search", GroupController.searchGroups);
router.get("/categories", GroupController.getCategories);

// Group CRUD
router.post(
  "/",
  upload.fields([
    { name: "group_picture", maxCount: 1 },
    { name: "group_cover", maxCount: 1 },
  ]),
  GroupController.createGroup
);

// ✅ MOVED: Public posts route before /:groupId
router.get("/:groupId/public-posts", GroupController.getGroupPosts);

// ✅ PUT THIS LAST: Single group route (parameterized routes should come last)
router.get("/:groupId", GroupController.getGroup);

// All other routes that start with /:groupId
router.put(
  "/:groupId",
  upload.fields([
    { name: "group_picture", maxCount: 1 },
    { name: "group_cover", maxCount: 1 },
  ]),
  GroupController.updateGroup
);
router.delete("/:groupId", GroupController.deleteGroup);
router.post("/:groupId/restore", GroupController.restoreGroup);

// Membership
router.post("/:groupId/join", GroupController.joinGroup);
router.post("/:groupId/leave", GroupController.leaveGroup);
router.get("/:groupId/members", GroupController.getGroupMembers);
router.get("/:groupId/pending-requests", GroupController.getPendingRequests);
router.patch("/:groupId/members/:memberId", GroupController.handleJoinRequest);
router.post("/:groupId/transfer-ownership", GroupController.transferOwnership);
router.delete("/:groupId/members/:memberId", GroupController.removeMember);
router.post("/:groupId/add-member", GroupController.addMember);

// Posts - UPDATED to use postUpload instead of upload
router.post(
  "/:groupId/posts",
  postUpload.fields([
    { name: "photos", maxCount: 10 },
    { name: "videos", maxCount: 5 },
    { name: "files", maxCount: 5 },
  ]),
  GroupController.createPost
);

router.get("/:groupId/posts", GroupController.getGroupPosts);
router.patch("/:groupId/posts/:postId/approval", GroupController.approvePost);
router.delete("/:groupId/posts/:postId", GroupController.deletePost);

// Admins
router.post("/:groupId/admins", GroupController.addAdmin);
router.delete("/:groupId/admins/:adminId", GroupController.removeAdmin);

// Analytics
router.get("/:groupId/analytics", GroupController.getAnalytics);

// Rating
router.post("/:groupId/rate", GroupController.rateGroup);

// Categories (admin only)
router.post("/categories", GroupController.createCategory);
router.put("/categories/:categoryId", GroupController.updateCategory);
router.delete("/categories/:categoryId", GroupController.deleteCategory);

// Pinning
router.post("/:groupId/pin", GroupController.pinPost);
router.delete("/:groupId/pin", GroupController.unpinPost);

// Chatbox
router.put("/:groupId/chatbox", GroupController.toggleChatbox);

// Events
router.get("/:groupId/events", GroupController.getGroupEvents);

// Albums
router.get("/:groupId/albums", GroupController.getGroupAlbums);

// Error handling middleware
router.use(GroupController.handleError);

module.exports = router;
