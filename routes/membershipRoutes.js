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
 * Purchase / activate a package
 * POST /api/membership/subscribe
 */
router.post(
  "/subscribe",
  authenticateToken,
  membershipController.subscribeToPackage,
);

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

/**
 * Cancel current membership subscription
 * POST /api/membership/cancel
 */
router.post(
  "/cancel",
  authenticateToken,
  membershipController.cancelSubscription,
);

module.exports = router;
