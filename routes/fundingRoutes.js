const express = require("express");
const router = express.Router();
const multer = require("multer");
const {
  createFunding,
  donateToFunding,
  withdrawFundingToWallet,
  getMyFundingDashboard,
} = require("../controllers/fundingController");
const { authenticateToken } = require("../middleware/authMiddleware");

// Same multer as your post/comment routes
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
    cb(null, allowed.includes(file.mimetype));
  },
});

router.post("/create", authenticateToken, upload.single("cover"), createFunding);
router.post("/:postId/donate", authenticateToken, donateToFunding);
router.post("/withdraw-to-wallet", authenticateToken, withdrawFundingToWallet);
router.get("/dashboard", authenticateToken, getMyFundingDashboard);

module.exports = router;