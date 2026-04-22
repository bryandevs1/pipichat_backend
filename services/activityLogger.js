const pool = require("../config/db");
const oneSignalService = require("./onesignalService");

class ActivityLogger {
  /**
   * Log user activity with OneSignal push notification
   */
  static async logActivity(options) {
    try {
      const {
        user_id,
        action,
        node_type,
        node_id,
        details = {},
        target_user_id = null,
        send_push = true, // Flag to control push notifications
      } = options;

      if (!user_id || !action) {
        console.warn("Activity logging skipped: missing user_id or action");
        return;
      }

      // Store in notifications table
      await this.createNotification({
        user_id,
        action,
        node_type,
        node_id,
        details,
        target_user_id,
      });

      // Send push notification if enabled and there's a target user
      if (send_push && target_user_id && target_user_id !== user_id) {
        await this.sendPushNotification({
          user_id,
          action,
          node_type,
          node_id,
          details,
          target_user_id,
        });
      }

      // For group activities that need to notify admins
      if (node_type === "group" && this.isGroupAdminAction(action)) {
        await this.notifyGroupAdminsWithPush(node_id, user_id, action, details);
      }

      // Log to console for development
      if (process.env.NODE_ENV === "development") {
        console.log(`[ACTIVITY] ${action}:`, {
          user_id,
          node_type,
          node_id,
          timestamp: new Date().toISOString(),
          details,
        });
      }
    } catch (error) {
      console.error("Activity logging error:", error);
    }
  }

  /**
   * Send push notification via OneSignal
   */
  static async sendPushNotification(options) {
    try {
      const { user_id, action, node_type, node_id, details, target_user_id } =
        options;

      // Get notification configuration
      const notificationConfig = this.getPushNotificationConfig(
        action,
        details
      );

      if (!notificationConfig) {
        return; // No push notification for this action
      }

      // Get actor user info for the notification
      const [actorUser] = await pool.query(
        "SELECT username, user_firstname, user_lastname FROM users WHERE user_id = ?",
        [user_id]
      );

      const actorName =
        actorUser[0]?.username || actorUser[0]?.user_firstname || "Someone";

      // Build notification message
      const message = this.buildPushMessage(action, actorName, details);
      const title = notificationConfig.title || "Notification";
      const url = this.generateNodeUrl(node_type, node_id);

      // Prepare notification data
      const notification = {
        title,
        message,
        url,
        data: {
          action,
          node_type,
          node_id,
          actor_id: user_id,
          timestamp: new Date().toISOString(),
          ...details,
        },
        type: notificationConfig.type || "default",
      };

      // Send push notification to target user
      await oneSignalService.sendToUsers(target_user_id, notification);

      console.log(
        `Push notification sent to user ${target_user_id}: ${action}`
      );
    } catch (error) {
      console.error("Push notification error:", error);
    }
  }

  /**
   * Build push notification message based on action
   */
  static buildPushMessage(action, actorName, details) {
    const messageTemplates = {
      GROUP_JOIN_REQUESTED: `${actorName} requested to join your group`,
      GROUP_JOIN_APPROVED: `Your request to join "${details.group_name}" was approved`,
      GROUP_POST_CREATED: `${actorName} posted in "${details.group_name}"`,
      POST_LIKED: `${actorName} liked your post`,
      POST_COMMENTED: `${actorName} commented on your post`,
      FRIEND_REQUEST_SENT: `${actorName} sent you a friend request`,
      FRIEND_REQUEST_ACCEPTED: `${actorName} accepted your friend request`,
      GROUP_INVITATION: `${actorName} invited you to join "${details.group_name}"`,
      NEW_MESSAGE: `New message from ${actorName}`,
      EVENT_REMINDER: `Reminder: "${details.event_title}" starts soon`,
      MENTION: `${actorName} mentioned you in a post`,
    };

    return messageTemplates[action] || `${actorName} performed an action`;
  }

  /**
   * Get push notification configuration
   */
  static getPushNotificationConfig(action, details) {
    const configs = {
      GROUP_JOIN_REQUESTED: {
        title: "New Join Request",
        type: "group",
        priority: "high",
      },
      GROUP_JOIN_APPROVED: {
        title: "Join Request Approved",
        type: "group",
        priority: "normal",
      },
      GROUP_POST_CREATED: {
        title: "New Group Post",
        type: "post",
        priority: "normal",
      },
      POST_LIKED: {
        title: "New Like",
        type: "post",
        priority: "low",
      },
      POST_COMMENTED: {
        title: "New Comment",
        type: "post",
        priority: "normal",
      },
      NEW_MESSAGE: {
        title: "New Message",
        type: "message",
        priority: "high",
      },
      FRIEND_REQUEST_SENT: {
        title: "Friend Request",
        type: "social",
        priority: "normal",
      },
      EVENT_REMINDER: {
        title: "Event Reminder",
        type: "event",
        priority: "high",
      },
    };

    return (
      configs[action] || {
        title: "Notification",
        type: "default",
        priority: "normal",
      }
    );
  }

  /**
   * Notify group admins with push notifications
   */
  static async notifyGroupAdminsWithPush(groupId, fromUserId, action, details) {
    try {
      // Get all group admins except the actor
      const [admins] = await pool.query(
        `SELECT ga.user_id, u.onesignal_user_id 
         FROM groups_admins ga
         JOIN users u ON u.user_id = ga.user_id
         WHERE ga.group_id = ? AND ga.user_id != ?`,
        [groupId, fromUserId]
      );

      // Get group info
      const [group] = await pool.query(
        "SELECT group_title FROM groups WHERE group_id = ?",
        [groupId]
      );

      const groupTitle = group[0]?.group_title || "the group";

      // Build admin notification message
      let message = "";
      if (action === "GROUP_JOIN_REQUESTED") {
        message = `New join request for "${groupTitle}"`;
      } else if (action === "GROUP_POST_SUBMITTED_FOR_APPROVAL") {
        message = `New post awaiting approval in "${groupTitle}"`;
      }

      if (message) {
        // Send push notifications to admins
        const adminIds = admins.map((admin) => admin.user_id);

        if (adminIds.length > 0) {
          await oneSignalService.sendToUsers(adminIds, {
            title: "Group Admin Alert",
            message,
            url: `/groups/${groupId}/admin`,
            data: {
              action,
              group_id: groupId,
              requires_action: true,
            },
            type: "admin",
          });
        }
      }
    } catch (error) {
      console.error("Group admin push notification error:", error);
    }
  }

  /**
   * Send bulk push notifications (for announcements, etc.)
   */
  static async sendBulkNotification(userIds, title, message, data = {}) {
    try {
      if (!userIds || userIds.length === 0) {
        console.warn("No users specified for bulk notification");
        return;
      }

      const result = await oneSignalService.sendToUsers(userIds, {
        title,
        message,
        data,
        type: "bulk",
      });

      return result;
    } catch (error) {
      console.error("Bulk notification error:", error);
      return null;
    }
  }

  /**
   * Send announcement to all group members
   */
  static async sendGroupAnnouncement(groupId, title, message, fromUserId) {
    try {
      // Get all group members
      const [members] = await pool.query(
        `SELECT gm.user_id 
         FROM groups_members gm
         WHERE gm.group_id = ? AND gm.approved = '1' AND gm.user_id != ?`,
        [groupId, fromUserId]
      );

      const memberIds = members.map((member) => member.user_id);

      if (memberIds.length > 0) {
        await this.sendBulkNotification(memberIds, title, message, {
          group_id: groupId,
          announcement: true,
          from_user_id: fromUserId,
        });
      }
    } catch (error) {
      console.error("Group announcement error:", error);
    }
  }

  /**
   * Send event reminder push notifications
   */
  static async sendEventReminder(eventId, minutesBefore = 60) {
    try {
      // Get event info
      const [event] = await pool.query(
        `SELECT e.*, 
                (SELECT COUNT(*) FROM events_members em 
                 WHERE em.event_id = e.event_id AND em.is_going = '1') as going_count
         FROM events e
         WHERE e.event_id = ?`,
        [eventId]
      );

      if (event.length === 0) return;

      const eventData = event[0];
      const eventTime = new Date(eventData.event_start_date);
      const now = new Date();

      // Calculate time difference in minutes
      const timeDiff = (eventTime - now) / (1000 * 60);

      if (timeDiff <= minutesBefore && timeDiff > 0) {
        // Get users who are going to the event
        const [attendees] = await pool.query(
          `SELECT em.user_id 
           FROM events_members em
           WHERE em.event_id = ? AND em.is_going = '1'`,
          [eventId]
        );

        const attendeeIds = attendees.map((attendee) => attendee.user_id);

        if (attendeeIds.length > 0) {
          await this.sendBulkNotification(
            attendeeIds,
            "Event Reminder",
            `"${eventData.event_title}" starts in ${Math.round(
              timeDiff
            )} minutes`,
            {
              event_id: eventId,
              reminder: true,
              starts_in_minutes: Math.round(timeDiff),
            }
          );
        }
      }
    } catch (error) {
      console.error("Event reminder error:", error);
    }
  }
}

module.exports = ActivityLogger;
