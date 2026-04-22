const db = require("../config/db");

const Notification = {
  findByUserId: async (userId, limit, offset) => {
    try {
      const [rows] = await db.query(
        `
        SELECT n.*, u.user_name AS from_username, u.user_picture AS from_profile_picture
        FROM notifications n
        LEFT JOIN users u ON n.from_user_id = u.user_id
        WHERE n.to_user_id = ?
        ORDER BY n.time DESC
        LIMIT ? OFFSET ?
        `,
        [userId, parseInt(limit), parseInt(offset)]
      );
      return rows;
    } catch (error) {
      console.error("Error fetching notifications:", error);
      throw error;
    }
  },

  getUnseenCount: async (userId) => {
    try {
      const [rows] = await db.query(
        "SELECT COUNT(*) AS count FROM notifications WHERE to_user_id = ? AND seen = '0'",
        [userId]
      );
      return rows[0].count;
    } catch (error) {
      console.error("Error getting unseen count:", error);
      throw error;
    }
  },

  markAsSeen: async (userId) => {
    try {
      await db.query(
        "UPDATE notifications SET seen = '1' WHERE to_user_id = ? AND seen = '0'",
        [userId]
      );
    } catch (error) {
      console.error("Error marking notifications as seen:", error);
      throw error;
    }
  },

  markSpecificAsSeen: async (userId, notificationIds) => {
    try {
      const placeholders = notificationIds.map(() => "?").join(",");
      await db.query(
        `UPDATE notifications SET seen = '1' WHERE to_user_id = ? AND notification_id IN (${placeholders})`,
        [userId, ...notificationIds]
      );
    } catch (error) {
      console.error("Error marking specific notifications as seen:", error);
      throw error;
    }
  },

  deleteNotification: async (userId, notificationId) => {
    try {
      const [result] = await db.query(
        "DELETE FROM notifications WHERE to_user_id = ? AND notification_id = ?",
        [userId, notificationId]
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error("Error deleting notification:", error);
      throw error;
    }
  },
};

module.exports = Notification;