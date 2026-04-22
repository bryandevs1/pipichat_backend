const express = require("express");
const router = express.Router();
const membershipController = require("../controllers/membershipController");
const authMiddleware = require("../middleware/authMiddleware");

// Middleware to authenticate token
const authenticateToken = authMiddleware.authenticateToken;

/**
 * Get all available packages
 * GET /api/membership/packages
 */
router.get("/packages", membershipController.getAllPackages);

/**
 * Get user's current package
 * GET /api/membership/user-package
 */
router.get(
  "/user-package",
  authenticateToken,
  membershipController.getUserPackage,
);

/**
 * Get user's boosted posts since membership started
 * GET /api/membership/user-boosted-posts
 */
router.get(
  "/user-boosted-posts",
  authenticateToken,
  membershipController.getUserBoostedPosts,
);

/**
 * Get user's boosted pages since membership started
 * GET /api/membership/user-boosted-pages
 */
router.get(
  "/user-boosted-pages",
  authenticateToken,
  membershipController.getUserBoostedPages,
);

module.exports = router;
