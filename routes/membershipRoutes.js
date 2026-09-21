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

/**
 * Verify an In-App Purchase receipt (Apple StoreKit / Google Play)
 * and activate the matching membership.
 * POST /api/membership/iap/verify
 */
router.post(
  "/iap/verify",
  authenticateToken,
  membershipController.verifyIapSubscription,
);

/**
 * App Store Server Notifications V2 webhook.
 *
 * Called by Apple (not the app), so there is NO authenticateToken here -
 * authenticity is proved by verifying the JWS signature chain instead.
 * Configure this URL in App Store Connect:
 *   App Information -> App Store Server Notifications
 * POST /api/membership/app-store-notifications
 */
router.post(
  "/app-store-notifications",
  membershipController.handleAppStoreNotification,
);

module.exports = router;
