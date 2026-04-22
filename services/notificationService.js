/**
 * Notification Service
 * Handles creating notifications and sending push notifications
 */

const db = require("../config/db");

class NotificationService {
  static getIO() {
    try {
      return require("../index").io;
    } catch (error) {
      console.warn("⚠️ Socket.IO not available in NotificationService");
      return null;
    }
  }

  static getFCMService() {
    try {
      return require("./fcmService");
    } catch (error) {
      console.warn("⚠️ FCMService not available in NotificationService");
      return null;
    }
  }

  /**
   * Create a notification record and send real-time alerts
   * @param {number} toUserId - User receiving the notification
   * @param {number} fromUserId - User triggering the notification
   * @param {string} action - Action type (profile_visit, message, etc)
   * @param {string} message - Notification message
   * @param {string} nodeType - Type of node (post, message, profile, etc)
   * @param {number} nodeId - ID of the node
   * @param {string} nodeUrl - URL or path to navigate to
   */
  static async createNotification(
    toUserId,
    fromUserId,
    action,
    message = null,
    nodeType = null,
    nodeId = null,
    nodeUrl = null,
  ) {
    try {
      if (!toUserId || !fromUserId) {
        console.warn("⚠️ Notification: Missing toUserId or fromUserId");
        return null;
      }

      const query = `
        INSERT INTO notifications 
        (to_user_id, from_user_id, action, message, node_type, node_id, node_url, time, seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), '0')
      `;

      const defaultMsg = message || this.getDefaultMessage(action);

      const [result] = await db.query(query, [
        toUserId,
        fromUserId,
        action,
        defaultMsg,
        nodeType,
        nodeId,
        nodeUrl,
      ]);

      const notificationId = result.insertId;

      console.log(`✅ Notification created:`, {
        notification_id: notificationId,
        to_user: toUserId,
        from_user: fromUserId,
        action,
      });

      // 🔔 Emit real-time Socket.IO event to recipient
      const io = this.getIO();
      if (io) {
        try {
          io.to(`user_${toUserId}`).emit("notification", {
            notification_id: notificationId,
            to_user_id: toUserId,
            from_user_id: fromUserId,
            action,
            message: defaultMsg,
            node_type: nodeType,
            node_id: nodeId,
            node_url: nodeUrl,
            time: new Date(),
          });
          console.log(`📡 Socket.IO notification emitted to user ${toUserId}`);
        } catch (ioError) {
          console.warn(`⚠️ Failed to emit Socket.IO notification:`, ioError);
        }
      }

      // 📲 Send FCM push notification
      try {
        const fcmService = new (this.getFCMService())();
        const [senderRows] = await db.query(
          `SELECT user_firstname, user_lastname, user_name FROM users WHERE user_id = ? LIMIT 1`,
          [fromUserId],
        );

        const senderName = senderRows[0]
          ? `${senderRows[0].user_firstname || ""} ${senderRows[0].user_lastname || ""}`.trim() ||
            senderRows[0].user_name
          : "Someone";

        await fcmService.sendIncomingCallPush(toUserId, {
          title: this.getTitleForAction(action, senderName),
          body: defaultMsg,
          data: {
            notification_type: action,
            notification_id: notificationId,
            sender_id: fromUserId,
            sender_name: senderName,
            node_type: nodeType,
            node_id: nodeId,
            node_url: nodeUrl,
          },
        });
        console.log(`📲 FCM push sent to user ${toUserId}`);
      } catch (fcmError) {
        console.warn(`⚠️ Failed to send FCM notification:`, fcmError.message);
      }

      return notificationId;
    } catch (error) {
      console.error("❌ Error creating notification:", error);
      return null;
    }
  }

  /**
   * Get title for notification based on action type
   */
  static getTitleForAction(action, senderName) {
    const titles = {
      message_received: "New Message",
      wallet_transfer: "Money Received",
      follower_gained: "New Follower",
      friend_request: "Friend Request",
      friend_accepted: "Friend Request Accepted",
      profile_visit: "Profile Viewed",
      post_liked: "Post Liked",
      post_commented: "New Comment",
      reaction: "Post Reaction",
    };
    return titles[action] || "New Notification";
  }

  /**
   * Get default message for notification action
   */
  static getDefaultMessage(action) {
    const messages = {
      // Post activities
      post_created: "created a new post",
      post_viewed: "viewed your post",
      post_liked: "liked your post",
      post_commented: "commented on your post",
      post_shared: "shared your post",

      // Comment activities
      comment_liked: "liked your comment",
      comment_replied: "replied to your comment",

      // Reaction
      react_like: "liked your post",
      react_love: "loved your post",
      react_haha: "reacted with haha to your post",
      react_yay: "reacted with yay to your post",
      react_wow: "reacted with wow to your post",
      react_sad: "reacted with sad to your post",
      react_angry: "reacted with angry to your post",

      // Social
      friend_request: "sent you a friend request",
      friend_accepted: "accepted your friend request",
      follow: "started following you",
      follower_gained: "started following you",

      // Message
      message_received: "sent you a message",
      message_media: "sent you media",

      // Profile
      profile_visited: "visited your profile",
      profile_view: "viewed your profile",

      // Wallet/Money
      money_received: "sent you money",
      wallet_transfer: "transferred money to you",
      wallet_payment: "made a payment",

      // Others
      notification: "sent you a notification",
    };

    return messages[action] || `triggered an action: ${action}`;
  }

  /**
   * Send batch notifications
   */
  static async createBatchNotifications(
    toUserIds,
    fromUserId,
    action,
    message,
    nodeType,
    nodeId,
    nodeUrl,
  ) {
    try {
      const promises = toUserIds.map((toUserId) =>
        this.createNotification(
          toUserId,
          fromUserId,
          action,
          message,
          nodeType,
          nodeId,
          nodeUrl,
        ),
      );

      const results = await Promise.all(promises);
      console.log(
        `✅ Batch notifications created:`,
        results.filter((r) => r !== null).length,
      );
      return results;
    } catch (error) {
      console.error("❌ Error creating batch notifications:", error);
      return [];
    }
  }

  /**
   * Mark notifications as seen
   */
  static async markAsSeen(userId, notificationIds = null) {
    try {
      if (notificationIds && Array.isArray(notificationIds)) {
        const placeholders = notificationIds.map(() => "?").join(",");
        await db.query(
          `UPDATE notifications SET seen = '1' WHERE to_user_id = ? AND notification_id IN (${placeholders})`,
          [userId, ...notificationIds],
        );
      } else {
        await db.query(
          `UPDATE notifications SET seen = '1' WHERE to_user_id = ? AND seen = '0'`,
          [userId],
        );
      }
    } catch (error) {
      console.error("❌ Error marking notifications as seen:", error);
    }
  }

  /**
   * Delete notification
   */
  static async deleteNotification(userId, notificationId) {
    try {
      const [result] = await db.query(
        `DELETE FROM notifications WHERE to_user_id = ? AND notification_id = ?`,
        [userId, notificationId],
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error("❌ Error deleting notification:", error);
      return false;
    }
  }
}

module.exports = NotificationService;
