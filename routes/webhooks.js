const express = require("express");
const router = express.Router();
const fcmService = require("../services/fcmService");
const { authenticateToken } = require("../middleware/authMiddleware");

// Save user's FCM token
router.post("/push/register", authenticateToken, async (req, res) => {
  try {
    const token = req.body?.fcm_token || req.body?.expo_push_token;
    const userId = req.user?.id || req.user?.user_id;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "FCM token is required (fcm_token)",
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Authenticated user id is missing",
      });
    }

    const success = await fcmService.saveFCMToken(userId, token);

    if (success) {
      res.json({
        success: true,
        message: "FCM token registered successfully",
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to register FCM token",
      });
    }
  } catch (error) {
    console.error("FCM token registration error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Unregister user's FCM token
router.post("/push/unregister", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.user_id;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Authenticated user id is missing",
      });
    }

    const success = await fcmService.unregisterFCMToken(userId);

    if (success) {
      res.json({
        success: true,
        message: "FCM token unregistered successfully",
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to unregister FCM token",
      });
    }
  } catch (error) {
    console.error("FCM token unregistration error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Send a test push notification to the authenticated user or a specific user
router.post("/push/test", authenticateToken, async (req, res) => {
  try {
    const targetUserId = req.body?.user_id || req.user?.id || req.user?.user_id;

    if (!targetUserId) {
      return res.status(400).json({
        success: false,
        message: "Target user id is missing",
      });
    }

    const success = await fcmService.sendTestPush(targetUserId, {
      title: req.body?.title,
      body: req.body?.body,
      type: req.body?.type,
      data: req.body?.data,
    });

    if (success) {
      return res.json({
        success: true,
        message: "Test push sent successfully",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to send test push",
    });
  } catch (error) {
    console.error("FCM test push error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = router;
