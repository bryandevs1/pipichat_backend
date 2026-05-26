const db = require("../config/db");

class ExpoPushService {
  async getExpoPushTokenByUserId(userId) {
    try {
      const [rows] = await db.query(
        `SELECT onesignal_user_id AS push_token FROM users WHERE user_id = ? LIMIT 1`,
        [userId],
      );

      if (!rows.length) return null;

      const token = rows[0].push_token;
      if (!token || typeof token !== "string") return null;
      if (!token.startsWith("ExponentPushToken")) return null;

      return token;
    } catch (error) {
      console.error("❌ Failed to fetch Expo push token:", error);
      return null;
    }
  }

  async sendIncomingCallPush(userId, payload) {
    console.log(`📞 Attempting to send incoming call push to user ${userId}`);

    const token = await this.getExpoPushTokenByUserId(userId);
    if (!token) {
      console.log(`⚠️ No push token found for user ${userId}`);
      return null;
    }

    console.log(`📱 Token found: ${token.substring(0, 20)}...`);

    const message = {
      to: token,
      sound: "default",
      title: payload.title || "Incoming Call",
      body: payload.body || "You have an incoming call",
      data: payload.data || {},
      priority: "high",
      channelId: "incoming-calls",
    };

    try {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
          ...(process.env.EXPO_ACCESS_TOKEN
            ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(message),
      });

      const json = await response.json();

      if (!response.ok || json?.data?.status === "error") {
        console.error("❌ Expo push send failed:", json);
        return null;
      }

      console.log("✅ Expo push sent successfully:", json?.data?.id);
      return json;
    } catch (error) {
      console.error("❌ Expo push request failed:", error.message);
      return null;
    }
  }

  async saveExpoPushToken(userId, expoPushToken) {
    try {
      await db.query(
        `UPDATE users SET onesignal_user_id = ? WHERE user_id = ?`,
        [expoPushToken, userId],
      );
      return true;
    } catch (error) {
      console.error("❌ Failed to save Expo push token:", error);
      return false;
    }
  }

  async unregisterExpoPushToken(userId) {
    try {
      await db.query(
        `UPDATE users SET onesignal_user_id = NULL WHERE user_id = ?`,
        [userId],
      );
      return true;
    } catch (error) {
      console.error("❌ Failed to unregister Expo push token:", error);
      return false;
    }
  }
}

module.exports = new ExpoPushService();
