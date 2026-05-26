// routes/storyRoutes.js
const express = require("express");
const router = express.Router();
const storyController = require("../controllers/storyController");
const upload = require("../middleware/multer");
const { authenticateToken } = require("../middleware/authMiddleware"); // ADD THIS

// Apply authentication to all story routes
router.use(authenticateToken);

// Post a new story (single media upload)
router.post("/", upload.single("media"), storyController.postStory);

// Get stories feed
router.get("/feed", storyController.getStoriesFeed);

// Mark story as viewed
router.post("/view", storyController.markStoryViewed);

// Get stories by specific user
router.get("/user/:userId", storyController.getUserStories);

// Get story details
router.get("/:storyId", storyController.getStoryById);

// Delete a story
router.delete("/:storyId", storyController.deleteStory);

// Get story viewers
router.get("/:storyId/viewers", storyController.getStoryViewers);

// Add story reaction
router.post("/:storyId/react", storyController.reactToStory);

// Get story reactions
router.get("/:storyId/reactions", storyController.getStoryReactions);

// Check if user has active story
router.get("/check/active", storyController.checkActiveStory);

// Get unviewed stories count
router.get("/count/unviewed", storyController.getUnviewedCount);

// Mark all stories as viewed for a user
router.post("/mark-all-viewed", storyController.markAllStoriesViewed);

module.exports = router;
