const express = require("express");
const router = express.Router();
const ReelController = require("../controllers/reelController");
const authMiddleware = require("../middleware/authMiddleware");

router.get("/", authMiddleware, ReelController.getReels);
router.get("/:postId", authMiddleware, ReelController.getReel);
router.delete("/:postId", authMiddleware, ReelController.deleteReel);

module.exports = router;
