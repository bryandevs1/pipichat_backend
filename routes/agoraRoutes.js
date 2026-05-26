const express = require("express");
const router = express.Router();
const AgoraController = require("../controllers/agoraController");
const { authenticateToken } = require("../middleware/authMiddleware");
const agoraConfig = require("../config/agora");
// Apply auth middleware to all routes
router.use(authenticateToken);

// Token generation
router.post("/tokens", AgoraController.generateCallTokens);

// Call management
router.put("/call/status", AgoraController.updateCallStatus);
router.get("/call-history", AgoraController.getCallHistory);
router.get("/active-calls", AgoraController.getActiveCalls);
// Add these routes to your existing agoraRoutes.js

// Live streaming routes
router.post("/live/chat", AgoraController.sendLiveChat);
router.get("/live/chat/:post_id", AgoraController.getLiveChat);
router.get("/live/viewers/:post_id", AgoraController.getViewerCount);
router.post("/live/end/:post_id", AgoraController.endLiveStream);

router.post("/live/token", AgoraController.generateLiveToken);
router.post("/live/start-recording", AgoraController.startLiveRecording);
router.post("/live/stop-recording", AgoraController.stopLiveRecording);
router.get("/live/info/:post_id", AgoraController.getLiveInfo);
router.get("/live/active", AgoraController.getActiveLives);
router.post("/live/join", AgoraController.joinLiveStream);
router.post("/live/leave", AgoraController.leaveLiveStream);
// In agoraRoutes.js
router.get("/test", (req, res) => {
  console.log("🧪 Test endpoint hit");

  const appId = agoraConfig.appId;
  const hasCertificate = !!agoraConfig.appCertificate;

  res.json({
    success: true,
    agoraConfig: {
      hasAppId: !!appId,
      appIdLength: appId ? appId.length : 0,
      hasCertificate,
      configExists: !!agoraConfig,
    },
    message: "Backend is running",
  });
});
module.exports = router;
