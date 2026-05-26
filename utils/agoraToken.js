const { RtcTokenBuilder, RtcRole } = require("agora-access-token");
const agoraConfig = require("../config/agora");

class AgoraTokenService {
  /**
   * Generate RTC token for audio/video calls
   * Returns just the token string
   */
  static generateRTCToken(channelName, uid, role = RtcRole.PUBLISHER) {
    try {
      const appId = agoraConfig.appId;
      const appCertificate = agoraConfig.appCertificate;

      if (!appId || !appCertificate) {
        throw new Error("Missing Agora App ID or Certificate");
      }

      const expirationTimeInSeconds = 3600; // 1 hour
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

      // Return just the token string
      return RtcTokenBuilder.buildTokenWithUid(
        appId,
        appCertificate,
        channelName,
        uid,
        role,
        privilegeExpiredTs,
      );
    } catch (error) {
      console.error("❌ Error generating Agora token:", error);
      throw error;
    }
  }

  /**
   * Simple token generation - returns token string
   */
  static generateTokens(userId, channelName) {
    return this.generateRTCToken(channelName, userId);
  }
}

module.exports = AgoraTokenService;
