const Joi = require("joi");
const db = require("../config/db");
const {
  getFollowings,
  getFollowers,
  getFollowingsCount,
  getFollowersCount,
  isFollowing,
  followUser,
  unfollowUser,
} = require("../models/followingsModel");
const NotificationService = require("../services/notificationService");

const getFollowingsList = async (req, res) => {
  try {
    const { userId } = req.params;
    const viewerId = req.user?.id;
    if (!viewerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const schema = Joi.object({
      userId: Joi.number().integer().positive().required(),
      limit: Joi.number().integer().min(1).max(100).default(20),
      offset: Joi.number().integer().min(0).default(0),
      search: Joi.string().allow("").optional(),
    });
    const { error, value } = schema.validate({
      ...req.query,
      userId: parseInt(userId),
    });
    if (error) {
      return res
        .status(400)
        .json({ success: false, message: error.details[0].message });
    }

    const { limit, offset, search } = value;
    const { data, total_count, has_more } = await getFollowings(
      userId,
      viewerId,
      limit,
      offset,
      search,
    );
    console.log(`Followings fetched for ${userId}: ${data.length} items`);

    res.status(200).json({ success: true, data, total_count, has_more });
  } catch (error) {
    console.error("Error in getFollowingsList:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getFollowersList = async (req, res) => {
  try {
    const { userId } = req.params;
    const viewerId = req.user?.id;
    if (!viewerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const schema = Joi.object({
      userId: Joi.number().integer().positive().required(),
      limit: Joi.number().integer().min(1).max(100).default(20),
      offset: Joi.number().integer().min(0).default(0),
      search: Joi.string().allow("").optional(),
    });
    const { error, value } = schema.validate({
      ...req.query,
      userId: parseInt(userId),
    });
    if (error) {
      return res
        .status(400)
        .json({ success: false, message: error.details[0].message });
    }

    const { limit, offset, search } = value;
    const { data, total_count, has_more } = await getFollowers(
      userId,
      viewerId,
      limit,
      offset,
      search,
    );
    console.log(`Followers fetched for ${userId}: ${data.length} items`);

    res.status(200).json({ success: true, data, total_count, has_more });
  } catch (error) {
    console.error("Error in getFollowersList:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getFollowStats = async (req, res) => {
  try {
    const { userId } = req.params;
    const viewerId = req.user?.id;
    if (!viewerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const schema = Joi.object({
      userId: Joi.number().integer().positive().required(),
    });
    const { error } = schema.validate({ userId: parseInt(userId) });
    if (error) {
      return res
        .status(400)
        .json({ success: false, message: error.details[0].message });
    }

    const [totalFollowings, totalFollowers] = await Promise.all([
      getFollowingsCount(userId, viewerId),
      getFollowersCount(userId, viewerId),
    ]);

    console.log(`Follow stats for ${userId}:`, {
      total_followings: totalFollowings,
      total_followers: totalFollowers,
    });

    res.status(200).json({
      success: true,
      data: {
        total_followings: totalFollowings,
        total_followers: totalFollowers,
      },
    });
  } catch (error) {
    console.error("Error in getFollowStats:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const checkFollowingStatus = async (req, res) => {
  try {
    const { targetId } = req.params;
    const viewerId = req.user?.id;
    if (!viewerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const schema = Joi.object({
      targetId: Joi.number().integer().positive().required(),
    });
    const { error } = schema.validate({ targetId: parseInt(targetId) });
    if (error) {
      return res
        .status(400)
        .json({ success: false, message: error.details[0].message });
    }

    const follows = await isFollowing(viewerId, targetId);
    res.status(200).json({ success: true, data: { is_following: follows } });
  } catch (error) {
    console.error("Error in checkFollowingStatus:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const follow = async (req, res) => {
  try {
    const { followingId } = req.body;
    const viewerId = req.user?.id;
    if (!viewerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const schema = Joi.object({
      followingId: Joi.number().integer().positive().required(),
    });
    const { error } = schema.validate({ followingId: parseInt(followingId) });
    if (error) {
      return res
        .status(400)
        .json({ success: false, message: error.details[0].message });
    }

    if (viewerId === followingId) {
      return res
        .status(400)
        .json({ success: false, message: "Cannot follow yourself" });
    }

    await followUser(viewerId, followingId);

    // Get follower's name for push notification
    const [followerRows] = await db.query(
      `SELECT user_firstname, user_lastname, user_name FROM users WHERE user_id = ?`,
      [viewerId],
    );
    const followerName = followerRows[0]
      ? `${followerRows[0].user_firstname || ""} ${followerRows[0].user_lastname || ""}`.trim() ||
        followerRows[0].user_name
      : "Someone";

    // ✅ Create follower gained notification (includes Socket.IO emit and FCM push)
    await NotificationService.createNotification(
      followingId,
      viewerId,
      "follower_gained",
      `${followerName} started following you`,
      "profile",
      viewerId,
      `/profile/${viewerId}`,
    );

    res.status(201).json({ success: true, message: "Now following" });
  } catch (error) {
    console.error("Error in follow:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const unfollow = async (req, res) => {
  try {
    const { followingId } = req.params;
    const viewerId = req.user?.id;
    if (!viewerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const schema = Joi.object({
      followingId: Joi.number().integer().positive().required(),
    });
    const { error } = schema.validate({ followingId: parseInt(followingId) });
    if (error) {
      return res
        .status(400)
        .json({ success: false, message: error.details[0].message });
    }

    await unfollowUser(viewerId, followingId);
    res.status(200).json({ success: true, message: "Unfollowed" });
  } catch (error) {
    console.error("Error in unfollow:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getFollowingsList,
  getFollowersList,
  getFollowStats,
  checkFollowingStatus,
  follow,
  unfollow,
};
