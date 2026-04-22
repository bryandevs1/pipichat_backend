/**
 * Notification Service
 * Handles creating notifications and sending push notifications
 */

const db = require("../config/db");

class NotificationService {
  /**
   * Create a notification record
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

      const [result] = await db.query(query, [
        toUserId,
        fromUserId,
        action,
        message || this.getDefaultMessage(action),
        nodeType,
        nodeId,
        nodeUrl,
      ]);

      console.log(`✅ Notification created:`, {
        notification_id: result.insertId,
        to_user: toUserId,
        from_user: fromUserId,
        action,
      });

      return result.insertId;
    } catch (error) {
      console.error("❌ Error creating notification:", error);
      return null;
    }
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
