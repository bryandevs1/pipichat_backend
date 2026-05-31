const express = require("express");
const router = express.Router();
const ReelController = require("../controllers/reelController");
const { authenticateToken } = require("../middleware/authMiddleware");

router.get("/", authenticateToken, ReelController.getReels);
router.get("/:postId", authenticateToken, ReelController.getReel);
router.delete("/:postId", authenticateToken, ReelController.deleteReel);

module.exports = router;
