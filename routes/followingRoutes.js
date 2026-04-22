const express = require("express");
const {
  getFollowingsList,
  getFollowersList,
  getFollowStats,
  checkFollowingStatus,
  follow,
  unfollow,
} = require("../controllers/followingsController");
const { authenticateToken } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/:userId/followers", authenticateToken, getFollowersList);
router.get("/:userId/followings", authenticateToken, getFollowingsList);
router.get("/:userId/stats", authenticateToken, getFollowStats);
router.get("/following-status/:targetId", authenticateToken, checkFollowingStatus);
router.post("/follow", authenticateToken, follow);
router.delete("/follow/:followingId", authenticateToken, unfollow);

module.exports = router;