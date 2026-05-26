const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const authMiddleware = require("../middleware/authMiddleware");

// Protect all notification routes
router.use(authMiddleware.authenticateToken);

router.get("/", notificationController.getUserNotifications);
router.post("/mark-specific-as-seen", notificationController.markSpecificNotificationsAsSeen);
router.post("/delete", notificationController.deleteNotification);
router.post("/mark-as-seen", notificationController.markNotificationsAsSeen);
router.get("/unseen-count", notificationController.getUnseenCount);

module.exports = router;
