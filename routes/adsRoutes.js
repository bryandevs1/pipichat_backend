// routes/ads.js

const express = require("express");
const multer = require("multer");

const router = express.Router();

const AdsController = require("../controllers/adsController");
const { authenticateToken } = require("../middleware/authMiddleware");

/* ======================================================
   MULTER CONFIG
====================================================== */

const storage = multer.memoryStorage();

const adsUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"), false);
  },
});

/* ======================================================
   ✅  PUBLIC ROUTES  (no auth required)
====================================================== */

// Live / approved ads for the ad renderer
router.get("/", AdsController.getAllAds);

// System (admin HTML) ads – used by renderers
router.get("/system", AdsController.getSystemAds);

// Country list for audience targeting dropdowns
router.get("/meta/countries", AdsController.getCountries);

/* ======================================================
   🔐  PROTECTED ROUTES  (auth required)
====================================================== */

// Wallet balance – frontend uses this to show/disable Create button
router.get(
  "/wallet-balance",
  authenticateToken,
  AdsController.getWalletBalance,
);

// Current user's campaigns
router.get("/my", authenticateToken, AdsController.getMyCampaigns);

// Campaign stats (owner only)
router.get(
  "/:campaignId/stats",
  authenticateToken,
  AdsController.getCampaignStats,
);

// Single campaign detail
router.get("/:campaignId", AdsController.getCampaignById);

// Create campaign (image upload via multipart OR base64 in body)
router.post(
  "/",
  authenticateToken,
  adsUpload.fields([{ name: "ads_image", maxCount: 1 }]),
  AdsController.createCampaign,
);

// Update campaign (image optional)
router.put(
  "/:campaignId",
  authenticateToken,
  adsUpload.fields([{ name: "ads_image", maxCount: 1 }]),
  AdsController.updateCampaign,
);

// Delete / deactivate campaign + refund
router.delete("/:campaignId", authenticateToken, AdsController.deleteCampaign);

// Pause / Resume
router.patch(
  "/:campaignId/toggle",
  authenticateToken,
  AdsController.toggleCampaign,
);

// Record impression (called by ad renderer)
router.post("/:campaignId/view", AdsController.recordView);

// Record click (called by ad renderer)
router.post("/:campaignId/click", AdsController.recordClick);

/* ======================================================
   🛡️  ADMIN ROUTES
====================================================== */

// Approve a campaign
router.patch(
  "/:campaignId/approve",
  authenticateToken,
  AdsController.approveCampaign,
);

// Decline a campaign (with optional reason in body)
router.patch(
  "/:campaignId/decline",
  authenticateToken,
  AdsController.declineCampaign,
);

// System ads management (admin only)
router.post("/system", authenticateToken, AdsController.createSystemAd);

router.put("/system/:adsId", authenticateToken, AdsController.updateSystemAd);

router.delete(
  "/system/:adsId",
  authenticateToken,
  AdsController.deleteSystemAd,
);

module.exports = router;
