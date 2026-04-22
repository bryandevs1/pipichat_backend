const Notification = require("../models/notificationModel");

exports.getUserNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 20, offset = 0 } = req.query;

    const notifications = await Notification.findByUserId(
      userId,
      limit,
      offset
    );

    const formattedNotifications = notifications.map((notif) => ({
      id: notif.notification_id,
      name: notif.from_username || "Unknown User",
      message: notif.message || this.getDefaultMessage(notif.action),
      time: this.formatTime(notif.time),
      date: this.formatDate(notif.time),
      image: notif.from_profile_picture || "",
      action: notif.action,
      node_type: notif.node_type,
      node_url: notif.node_url,
      seen: notif.seen === "1",
    }));

    res.json({
      success: true,
      data: formattedNotifications,
      count: notifications.length,
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.markNotificationsAsSeen = async (req, res) => {
  try {
    const userId = req.user.id;
    await Notification.markAsSeen(userId);
    res.json({ success: true, message: "Notifications marked as seen" });
  } catch (error) {
    console.error("Error marking notifications as seen:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.markSpecificNotificationsAsSeen = async (req, res) => {
  try {
    const userId = req.user.id;
    const { notificationIds } = req.body;
    if (!notificationIds || !Array.isArray(notificationIds)) {
      return res.status(400).json({ success: false, message: "Invalid notification IDs" });
    }
    await Notification.markSpecificAsSeen(userId, notificationIds);
    res.json({ success: true, message: "Specified notifications marked as seen" });
  } catch (error) {
    console.error("Error marking specific notifications as seen:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteNotification = async (req, res) => {
  try {
    const userId = req.user.id;
    const { notificationId } = req.body;
    if (!notificationId) {
      return res.status(400).json({ success: false, message: "Notification ID required" });
    }
    const deleted = await Notification.deleteNotification(userId, notificationId);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }
    res.json({ success: true, message: "Notification deleted" });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getUnseenCount = async (req, res) => {
  try {
    const userId = req.user.id;
    const count = await Notification.getUnseenCount(userId);
    res.json({ success: true, count });
  } catch (error) {
    console.error("Error getting unseen notification count:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getDefaultMessage = (action) => {
  const messages = {
    profile_visit: "visited your profile",
    friend_add: "sent you a friend request",
    follow: "started following you",
    friend_accept: "accepted your friend request",
    react_like: "liked your post",
    react_wow: "reacted with 'Wow' to your post",
    live_stream: "is live now",
    comment: "commented on your post",
    reply: "replied to your comment",
    react_love: "reacted with 'Love' to your post",
    page_invitation: "invited you to like a page",
    video_converted: "your video has been processed",
    react_haha: "reacted with 'Haha' to your post",
    react_sad: "reacted with 'Sad' to your post",
    mention: "mentioned you in a post",
    share: "shared your post",
    group_add: "added you to a group",
    group_join: "joined the group",
    group_accept: "accepted your group invite",
    verification_request: "submitted a verification request",
    poke: "poked you",
    gift: "sent you a gift",
    vote: "voted in your poll",
    react_yay: "reacted with 'Yay' to your post",
    page_review: "left a review on your page",
  };
  return messages[action] || "sent you a notification";
};

exports.formatTime = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

exports.formatDate = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};