const dotenv = require("dotenv");
dotenv.config();

const agoraConfig = {
  appId: process.env.AGORA_APP_ID,
  appCertificate: process.env.AGORA_APP_CERTIFICATE,
  customerId: process.env.AGORA_CUSTOMER_ID,
  customerSecret: process.env.AGORA_CUSTOMER_SECRET,

  // Default token expiration (1 hour)
  tokenExpirationTime: 3600,

  // Role for token generation
  role: {
    publisher: 1, // Can publish audio/video
    subscriber: 2, // Can only subscribe
  },

  // Channel type
  channelType: {
    rtc: 0, // Communication mode
    live: 1, // Live streaming mode
  },

  // Privileges for tokens
  privileges: {
    joinChannel: 1,
    publishAudioStream: 2,
    publishVideoStream: 3,
    publishDataStream: 4,
  },
};

module.exports = agoraConfig;
