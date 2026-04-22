const OneSignal = require("onesignal-node");
require("dotenv").config();

class OneSignalService {
  constructor() {
    this.client = new OneSignal.Client(
      process.env.ONESIGNAL_APP_ID,
      process.env.ONESIGNAL_REST_API_KEY
    );
  }

  /**
   * Send push notification to specific user(s)
   * @param {Array|string} userIds - User IDs or OneSignal player IDs
   * @param {Object} notification - Notification data
   */
  async sendToUsers(userIds, notification) {
    try {
      // If userIds is a single string, convert to array
      const targetIds = Array.isArray(userIds) ? userIds : [userIds];

      // Filter out invalid IDs
      const validIds = targetIds.filter((id) => id && id.trim() !== "");

      if (validIds.length === 0) {
        console.warn("No valid user IDs for OneSignal notification");
        return null;
      }

      // Create notification payload
      const onesignalNotification = {
        contents: {
          en: notification.message || "New notification",
        },
        headings: {
          en: notification.title || "Notification",
        },
        data: notification.data || {},
        url: notification.url,
        ios_badgeType: "Increase",
        ios_badgeCount: 1,
        ...this.getNotificationSpecificSettings(notification),
      };

      // Check if we're sending to OneSignal player IDs or our user IDs
      if (this.areOneSignalIds(validIds)) {
        // Send to OneSignal player IDs
        onesignalNotification.include_player_ids = validIds;
      } else {
        // Send to our user IDs - we need to get their OneSignal IDs first
        const oneSignalIds = await this.getOneSignalIdsFromUserIds(validIds);
        if (oneSignalIds.length > 0) {
          onesignalNotification.include_player_ids = oneSignalIds;
        } else {
          console.warn("No OneSignal IDs found for users:", validIds);
          return null;
        }
      }

      // Send notification
      const response = await this.client.createNotification(
        onesignalNotification
      );
      console.log("OneSignal notification sent:", response.body.id);
      return response;
    } catch (error) {
      console.error("OneSignal error:", error);
      return null;
    }
  }

  /**
   * Send push notification to all users
   * @param {Object} notification - Notification data
   */
  async sendToAll(notification) {
    try {
      const onesignalNotification = {
        contents: {
          en: notification.message || "New notification",
        },
        headings: {
          en: notification.title || "Notification",
        },
        data: notification.data || {},
        url: notification.url,
        included_segments: ["All"],
        ios_badgeType: "Increase",
        ios_badgeCount: 1,
      };

      const response = await this.client.createNotification(
        onesignalNotification
      );
      console.log("OneSignal broadcast sent:", response.body.id);
      return response;
    } catch (error) {
      console.error("OneSignal broadcast error:", error);
      return null;
    }
  }

  /**
   * Send push notification to users with specific tags
   * @param {Object} tags - Tags to filter users
   * @param {Object} notification - Notification data
   */
  async sendByTags(tags, notification) {
    try {
      const onesignalNotification = {
        contents: {
          en: notification.message || "New notification",
        },
        headings: {
          en: notification.title || "Notification",
        },
        data: notification.data || {},
        url: notification.url,
        filters: Object.entries(tags).map(([key, value]) => ({
          field: "tag",
          key,
          relation: "=",
          value,
        })),
        ios_badgeType: "Increase",
        ios_badgeCount: 1,
      };

      const response = await this.client.createNotification(
        onesignalNotification
      );
      console.log("OneSignal tag-based notification sent:", response.body.id);
      return response;
    } catch (error) {
      console.error("OneSignal tag-based error:", error);
      return null;
    }
  }

  /**
   * Check if IDs are OneSignal player IDs (format: uuid-like)
   */
  areOneSignalIds(ids) {
    return ids.every((id) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    );
  }

  /**
   * Get OneSignal player IDs from our user IDs
   */
  async getOneSignalIdsFromUserIds(userIds) {
    const pool = require("../config/db");

    try {
      const [rows] = await pool.query(
        "SELECT onesignal_user_id FROM users WHERE user_id IN (?) AND onesignal_user_id IS NOT NULL",
        [userIds]
      );

      return rows.map((row) => row.onesignal_user_id).filter((id) => id);
    } catch (error) {
      console.error("Error fetching OneSignal IDs:", error);
      return [];
    }
  }

  /**
   * Update user's OneSignal ID in database
   * @param {number} userId - Your user ID
   * @param {string} oneSignalId - OneSignal player ID
   */
  async updateUserOneSignalId(userId, oneSignalId) {
    const pool = require("../config/db");

    try {
      await pool.query(
        "UPDATE users SET onesignal_user_id = ? WHERE user_id = ?",
        [oneSignalId, userId]
      );
      console.log(`Updated OneSignal ID for user ${userId}: ${oneSignalId}`);
      return true;
    } catch (error) {
      console.error("Error updating OneSignal ID:", error);
      return false;
    }
  }

  /**
   * Get notification-specific settings based on type
   */
  getNotificationSpecificSettings(notification) {
    const settings = {
      android_channel_id: process.env.ONESIGNAL_ANDROID_CHANNEL_ID || "default",
      small_icon: "ic_notification",
      large_icon: "ic_launcher",
      android_accent_color: "FF9966",
    };

    // Different sounds for different notification types
    if (notification.type === "message") {
      settings.ios_sound = "message.wav";
      settings.android_sound = "message";
    } else if (notification.type === "alert") {
      settings.ios_sound = "alert.wav";
      settings.android_sound = "alert";
    } else {
      settings.ios_sound = "default";
      settings.android_sound = "default";
    }

    return settings;
  }
}

// Singleton instance
module.exports = new OneSignalService();
