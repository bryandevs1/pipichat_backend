const jwt = require("jsonwebtoken");
const friendsModel = require("../models/friendsModel");
const Joi = require("joi");
const db = require("../config/db");
const NotificationService = require("../services/notificationService");

function authenticateUser(req, res, next) {
  console.log("authenticateUser: Processing request", {
    method: req.method,
    url: req.originalUrl,
    headers: req.headers,
    timestamp: new Date().toISOString(),
  });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.error(
      "authenticateUser: Missing or malformed Authorization header",
      { authHeader },
    );
    return res
      .status(401)
      .json({ error: "Unauthorized: Missing or malformed token" });
  }

  const token = authHeader.split(" ")[1];
  console.log("authenticateUser: Extracted token", { token });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("authenticateUser: Token decoded successfully", { decoded });
    req.user = decoded;
    next();
  } catch (error) {
    console.error("authenticateUser: JWT verification failed", {
      error: error.message,
      name: error.name,
      token,
    });
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Unauthorized: Token expired" });
    }
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
}

async function getUserProfile(req, res) {
  const { userId } = req.params;
  const viewerId = req.user.id;

  const schema = Joi.object({
    userId: Joi.number().integer().positive().required(),
  });
  const { error } = schema.validate({ userId: parseInt(userId) });
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const profile = await friendsModel.getUserProfile(
      parseInt(userId),
      viewerId,
    );
    if (!profile)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    // ✅ Create profile visit notification if viewing someone else's profile
    if (parseInt(userId) !== viewerId) {
      await NotificationService.createNotification(
        parseInt(userId),
        viewerId,
        "profile_visit",
        null,
        "profile",
        viewerId,
        `/profile/${viewerId}`,
      );
    }

    // Fetch follow counts
    const [[{ followers_count }]] = await db.query(
      `SELECT COUNT(*) as followers_count FROM followings WHERE following_id = ?`,
      [userId],
    );
    const [[{ following_count }]] = await db.query(
      `SELECT COUNT(*) as following_count FROM followings WHERE user_id = ?`,
      [userId],
    );
    const [isFollowing] = await db.query(
      `SELECT 1 FROM followings WHERE user_id = ? AND following_id = ?`,
      [viewerId, userId],
    );

    res.json({
      success: true,
      data: {
        user_id: profile.id,
        username: profile.username,
        name: profile.name,
        user_picture: profile.user_picture,
        user_cover: profile.user_cover || null,
        work_title: profile.work_title || null,
        work_place: profile.work_place || null,
        work_url: profile.work_url || null,
        user_verified: profile.user_verified || "0",
        followers_count: followers_count || 0,
        following_count: following_count || 0,
        mutual_friends_count: profile.mutual_friends || 0,
        is_following: isFollowing.length > 0 ? 1 : 0,
      },
    });
  } catch (error) {
    console.error("getUserProfile error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

async function sendFriendRequest(req, res) {
  console.log("sendFriendRequest: Starting request", {
    user: req.user,
    body: req.body,
    timestamp: new Date().toISOString(),
  });

  const schema = Joi.object({
    user_two_id: Joi.alternatives()
      .try(
        Joi.number().integer().positive(),
        Joi.string()
          .regex(/^\d+$/)
          .custom((value, helpers) => {
            const num = parseInt(value, 10);
            if (num <= 0) return helpers.error("number.positive");
            return num;
          }),
      )
      .required(),
  });

  const { error, value } = schema.validate(req.body, { convert: true });
  if (error) {
    console.error("sendFriendRequest: Validation error", {
      error: error.details,
      body: req.body,
    });
    return res.status(400).json({ error: error.details[0].message });
  }

  const user_one_id = req.user.id;
  const { user_two_id } = value;

  if (user_one_id === user_two_id) {
    return res
      .status(400)
      .json({ error: "Cannot send friend request to yourself" });
  }

  try {
    // Verify target user exists
    const [userExists] = await db.query(
      "SELECT 1 FROM users WHERE user_id = ?",
      [user_two_id],
    );
    if (!userExists.length) {
      return res.status(404).json({ error: "Target user not found" });
    }

    // Check for existing friendship
    const existingFriendship = await friendsModel.checkExistingFriendship(
      user_one_id,
      user_two_id,
    );
    if (existingFriendship.length > 0) {
      return res
        .status(400)
        .json({ error: "Friend request already sent or already friends" });
    }

    // Check if blocked
    const isBlocked = await friendsModel.checkIfBlocked(
      user_one_id,
      user_two_id,
    );
    if (isBlocked) {
      return res
        .status(403)
        .json({ error: "Cannot send friend request to a blocked user" });
    }

    // Create friend request
    const result = await friendsModel.createFriendRequest(
      user_one_id,
      user_two_id,
    );
    console.log("sendFriendRequest: Friend request created", {
      requestId: result.insertId,
    });

    // Get sender details for push notification
    const [senderRows] = await db.query(
      `SELECT user_firstname, user_lastname, user_name FROM users WHERE user_id = ?`,
      [user_one_id],
    );
    const senderName = senderRows[0]
      ? `${senderRows[0].user_firstname || ""} ${senderRows[0].user_lastname || ""}`.trim() ||
        senderRows[0].user_name
      : "Someone";

    // ✅ Create friend request notification
    await NotificationService.createNotification(
      user_two_id,
      user_one_id,
      "friend_request",
      null,
      "friend_request",
      result.insertId,
      `/friends/requests`,
    );

    // 📲 Send FCM push notification
    await NotificationService.sendPushNotification(
      user_two_id,
      senderName,
      "Friend Request",
      `${senderName} sent you a friend request`,
      {
        notification_type: "friend_request",
        sender_id: user_one_id,
        request_id: result.insertId,
        node_url: `/friends/requests`,
      },
    );

    res
      .status(201)
      .json({ message: "Friend request sent", requestId: result.insertId });
  } catch (error) {
    console.error("sendFriendRequest: Error occurred", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: "Something went wrong" });
  }
}

async function updateFriendStatus(req, res) {
  const { id } = req.params;
  const schema = Joi.object({
    status: Joi.number().integer().valid(1, 2).required(),
  });

  const { error } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { status } = req.body;

  try {
    const request = await friendsModel.getFriendRequestById(id);
    if (!request || request.user_two_id !== req.user.id) {
      return res
        .status(403)
        .json({ error: "Not authorized to update this request" });
    }

    let message;

    if (status === 1) {
      // Get friend request details to get sender ID
      const friendRequest = await friendsModel.getFriendRequestById(id);
      const result = await friendsModel.updateFriendRequest(id, 1);
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "Friend request not found" });
      }

      // Get recipient's details for push notification
      const [recipientRows] = await db.query(
        `SELECT user_firstname, user_lastname, user_name FROM users WHERE user_id = ?`,
        [req.user.id],
      );
      const recipientName = recipientRows[0]
        ? `${recipientRows[0].user_firstname || ""} ${recipientRows[0].user_lastname || ""}`.trim() ||
          recipientRows[0].user_name
        : "Someone";

      // ✅ Create friend accepted notification
      await NotificationService.createNotification(
        friendRequest.user_one_id,
        req.user.id,
        "friend_accepted",
        null,
        "friend_request",
        id,
        `/profile/${req.user.id}`,
      );

      // 📲 Send FCM push notification
      await NotificationService.sendPushNotification(
        friendRequest.user_one_id,
        recipientName,
        "Friend Request Accepted",
        `${recipientName} accepted your friend request`,
        {
          notification_type: "friend_accepted",
          user_id: req.user.id,
          request_id: id,
          node_url: `/profile/${req.user.id}`,
        },
      );

      message = "Friend request accepted";
    } else {
      const result = await friendsModel.deleteFriendship(id);
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "Friend request not found" });
      }
      message = "Friend request declined successfully";
    }

    res.json({ message });
  } catch (error) {
    console.error("updateFriendStatus: Error occurred", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: error.message || "Something went wrong" });
  }
}

async function getFriends(req, res) {
  console.log("getFriends: Starting request", {
    user: req.user,
    params: req.params,
    query: req.query,
    timestamp: new Date().toISOString(),
  });

  const { userId } = req.params;
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;

  if (req.user.id !== parseInt(userId)) {
    console.error("getFriends: Authorization failed", {
      userId: req.user.id,
      requestedUserId: userId,
    });
    return res
      .status(403)
      .json({ error: "Not authorized to view this user's friends" });
  }

  try {
    const friends = await friendsModel.getFriends(userId, limit, offset);
    console.log("getFriends: Fetched friends", { friends });
    res.json(friends);
  } catch (error) {
    console.error("getFriends: Error occurred", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: error.message || "Something went wrong" });
  }
}

async function removeFriend(req, res) {
  console.log("removeFriend: Starting request", {
    user: req.user,
    params: req.params,
    timestamp: new Date().toISOString(),
  });

  const { id } = req.params;

  try {
    const friendship = await friendsModel.getFriendRequestById(id);
    if (
      !friendship ||
      (friendship.user_one_id !== req.user.id &&
        friendship.user_two_id !== req.user.id)
    ) {
      return res
        .status(403)
        .json({ error: "Not authorized to remove this friend" });
    }

    const result = await friendsModel.deleteFriendship(id);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Friendship not found" });
    }

    res.json({ message: "Friend removed" });
  } catch (error) {
    console.error("removeFriend: Error occurred", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: error.message || "Something went wrong" });
  }
}

async function getSuggestedPeople(req, res) {
  console.log("getSuggestedPeople: Starting request", {
    user: req.user,
    query: req.query,
    timestamp: new Date().toISOString(),
  });

  const userId = req.user.id;
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;

  try {
    const suggested = await friendsModel.getSuggestedPeople(
      userId,
      limit,
      offset,
    );
    console.log("getSuggestedPeople: Fetched suggested people", { suggested });
    res.json(suggested);
  } catch (error) {
    console.error("getSuggestedPeople: Error occurred", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: error.message || "Something went wrong" });
  }
}

async function getFriendRequests(req, res) {
  console.log("getFriendRequests: Starting request", {
    user: req.user,
    query: req.query,
    timestamp: new Date().toISOString(),
  });

  const userId = req.user.id;
  console.log("getFriendRequests: Extracted userId", { userId });

  try {
    const requests = await friendsModel.getFriendRequests(userId);
    console.log("getFriendRequests: Fetched friend requests", { requests });
    res.json(requests);
  } catch (error) {
    console.error("getFriendRequests: Error occurred", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: error.message || "Something went wrong" });
  }
}

async function getSentRequests(req, res) {
  console.log("getSentRequests: Starting request", {
    user: req.user,
    query: req.query,
    timestamp: new Date().toISOString(),
  });

  const userId = req.user.id;
  console.log("getSentRequests: Extracted userId", { userId });

  try {
    const requests = await friendsModel.getSentRequests(userId);
    console.log("getSentRequests: Fetched sent friend requests", { requests });
    res.json(requests);
  } catch (error) {
    console.error("getSentRequests: Error occurred", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: error.message || "Something went wrong" });
  }
}

async function getUsersBySearch(req, res) {
  console.log("getUsersBySearch: Starting request", {
    user: req.user,
    query: req.query,
    timestamp: new Date().toISOString(),
  });

  const { query } = req.query;
  const userId = req.user.id;

  if (!query || query.trim() === "") {
    return res.status(400).json({ error: "Search query is required" });
  }

  try {
    const users = await friendsModel.searchUsers(query, userId);
    console.log("getUsersBySearch: Fetched users", { users });
    res.json(users);
  } catch (error) {
    console.error("getUsersBySearch: Error occurred", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: error.message || "Something went wrong" });
  }
}

async function getFriendStatus(req, res) {
  console.log("getFriendStatus: Starting request", {
    user: req.user,
    params: req.params,
    timestamp: new Date().toISOString(),
  });

  const { userId } = req.params;
  const schema = Joi.object({
    userId: Joi.number().integer().positive().required(),
  });

  const { error } = schema.validate({ userId });
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const status = await friendsModel.getFriendStatus(
      req.user.id,
      parseInt(userId),
    );
    console.log("getFriendStatus: Fetched status", { status });
    res.json(status);
  } catch (error) {
    console.error("getFriendStatus: Error occurred", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: error.message || "Something went wrong" });
  }
}
async function getFollowers(req, res) {
  const { userId } = req.params;
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;

  try {
    const followers = await friendsModel.getFollowers(userId, limit, offset);
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM followings WHERE following_id = ?`,
      [userId],
    );

    res.json({
      success: true,
      data: followers,
      has_more: followers.length === limit,
      total_count: total,
    });
  } catch (err) {
    console.error("getFollowers error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

async function getFollowing(req, res) {
  const { userId } = req.params;
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;

  try {
    const following = await friendsModel.getFollowing(userId, limit, offset);
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM followings WHERE user_id = ?`,
      [userId],
    );

    res.json({
      success: true,
      data: following,
      has_more: following.length === limit,
      total_count: total,
    });
  } catch (err) {
    console.error("getFollowing error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}
module.exports = {
  sendFriendRequest,
  updateFriendStatus,
  getFriends,
  removeFriend,
  authenticateUser,
  getSuggestedPeople,
  getFriendRequests,
  getSentRequests,
  getUsersBySearch,
  getUserProfile,
  getFriendStatus,
  getFollowers,
  getFollowing,
};
