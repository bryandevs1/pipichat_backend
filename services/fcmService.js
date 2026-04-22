const db = require("../config/db");
const admin = require("firebase-admin");
const fs = require("node:fs");
const path = require("node:path");

// Initialize Firebase Admin if not already done
let firebaseInitialized = false;

class FCMService {
  constructor() {
    this.initializeFirebase();
  }

  initializeFirebase() {
    try {
      if (!firebaseInitialized && !admin.apps.length) {
        const configuredPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
        const candidatePaths = [
          configuredPath,
          path.join(
            process.cwd(),
            "africanawa-firebase-adminsdk-fbsvc-023b83f98a.json",
          ),
        ].filter(Boolean);

        const discovered = fs
          .readdirSync(process.cwd())
          .find((name) => /firebase-adminsdk.*\.json$/i.test(name));

        if (discovered) {
          candidatePaths.push(path.join(process.cwd(), discovered));
        }

        const serviceAccountPath = candidatePaths.find((p) => fs.existsSync(p));

        if (serviceAccountPath) {
          const serviceAccount = require(serviceAccountPath);
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
          });
          console.log(
            `✅ Firebase Admin initialized using ${path.basename(serviceAccountPath)}`,
          );
        } else {
          admin.initializeApp();
          console.warn(
            "⚠️ Firebase Admin initialized with default credentials. Set FIREBASE_SERVICE_ACCOUNT_PATH if push fails.",
          );
        }

        firebaseInitialized = true;
      }
    } catch (error) {
      console.warn(
        "⚠️ Firebase Admin init (may already be initialized):",
        error.message,
      );
    }
  }

  async getFCMTokenByUserId(userId) {
    try {
      console.log("🔎 FCM token lookup started", { userId });
      const [rows] = await db.query(
        `SELECT fcm_token FROM users WHERE user_id = ? LIMIT 1`,
        [userId],
      );

      if (!rows.length) {
        console.log(`⚠️ No user row found for FCM lookup`, { userId });
        return null;
      }

      const token = rows[0].fcm_token;
      if (!token || typeof token !== "string") {
        console.log(`⚠️ Invalid FCM token for user ${userId}`, {
          userId,
          tokenType: typeof token,
          hasToken: !!token,
        });
        return null;
      }

      console.log("✅ FCM token lookup success", {
        userId,
        tokenPreview: `${token.substring(0, 16)}...`,
        tokenLength: token.length,
      });

      return token;
    } catch (error) {
      console.error("❌ Failed to fetch FCM token:", error);
      return null;
    }
  }

  async sendIncomingCallPush(userId, payload) {
    const traceId = `fcm:${userId}:${Date.now()}`;
    console.log(`📞 Attempting to send incoming call push to user ${userId}`, {
      traceId,
      title: payload?.title,
      hasBody: !!payload?.body,
      dataKeys: Object.keys(payload?.data || {}),
    });

    const token = await this.getFCMTokenByUserId(userId);
    if (!token) {
      console.log(`⚠️ No FCM token found for user ${userId}`, { traceId });
      return null;
    }

    console.log(`📱 FCM token found: ${token.substring(0, 30)}...`, {
      traceId,
    });

    const normalizedData = Object.fromEntries(
      Object.entries(payload.data || {}).map(([key, value]) => [
        key,
        String(value ?? ""),
      ]),
    );

    console.log("🧱 FCM normalized data prepared", {
      traceId,
      normalizedData,
    });

    const message = {
      token,
      notification: {
        title: payload.title || "Incoming Call",
        body: payload.body || "You have an incoming call",
      },
      data: normalizedData,
      android: {
        priority: "high",
        ttl: 3600,
        notification: {
          channelId: "incoming-calls",
          sound: "default",
          priority: "max",
          visibility: "public",
        },
      },
      apns: {
        headers: {
          "apns-priority": "10",
          "apns-push-type": "alert",
        },
        payload: {
          aps: {
            alert: {
              title: payload.title || "Incoming Call",
              body: payload.body || "You have an incoming call",
            },
            sound: "default",
            badge: 1,
          },
        },
      },
    };

    try {
      console.log("🚀 Sending FCM message", {
        traceId,
        tokenPreview: `${token.substring(0, 16)}...`,
        androidChannel: message?.android?.notification?.channelId,
      });
      const response = await admin.messaging().send(message);
      console.log("✅ FCM message sent successfully:", {
        traceId,
        response,
      });
      return response;
    } catch (error) {
      console.error("❌ FCM send failed:", {
        traceId,
        message: error?.message,
        code: error?.code,
        codePrefix: error?.codePrefix,
        errorInfo: error?.errorInfo,
        stack: error?.stack,
      });
      return null;
    }
  }

  async sendTestPush(userId, payload = {}) {
    console.log(`🧪 Attempting to send test push to user ${userId}`);

    const token = await this.getFCMTokenByUserId(userId);
    if (!token) {
      console.log(`⚠️ No FCM token found for user ${userId}`);
      return null;
    }

    const title = payload.title || "Pipitrend Test Notification";
    const body = payload.body || "Your FCM setup is working.";

    const message = {
      token,
      notification: {
        title,
        body,
      },
      data: {
        type: payload.type || "test_notification",
        ...Object.fromEntries(
          Object.entries(payload.data || {}).map(([key, value]) => [
            key,
            String(value),
          ]),
        ),
      },
      android: {
        priority: "high",
        notification: {
          channelId: "incoming-calls",
          sound: "default",
        },
      },
      apns: {
        headers: {
          "apns-priority": "10",
          "apns-push-type": "alert",
        },
        payload: {
          aps: {
            alert: {
              title,
              body,
            },
            sound: "default",
          },
        },
      },
    };

    try {
      const response = await admin.messaging().send(message);
      console.log("✅ Test FCM message sent successfully:", response);
      return response;
    } catch (error) {
      console.error("❌ Test FCM send failed:", error.message);
      return null;
    }
  }

  async saveFCMToken(userId, fcmToken) {
    try {
      await db.query(`UPDATE users SET fcm_token = ? WHERE user_id = ?`, [
        fcmToken,
        userId,
      ]);
      console.log(`✅ FCM token saved for user ${userId}`);
      return true;
    } catch (error) {
      console.error("❌ Failed to save FCM token:", error);
      return false;
    }
  }

  async unregisterFCMToken(userId) {
    try {
      await db.query(`UPDATE users SET fcm_token = NULL WHERE user_id = ?`, [
        userId,
      ]);
      console.log(`✅ FCM token cleared for user ${userId}`);
      return true;
    } catch (error) {
      console.error("❌ Failed to unregister FCM token:", error);
      return false;
    }
  }
}

module.exports = new FCMService();
