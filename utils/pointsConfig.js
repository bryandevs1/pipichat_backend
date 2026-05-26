/**
 * Points/Coins Configuration
 * Store all point allocations as configurable variables
 * Can be moved to database later for dynamic updates
 */

const POINTS_CONFIG = {
  // Conversion rate
  CONVERSION_RATE: {
    POINTS_PER_NAIRA: 1, // How many points equal ₦1
  },

  // Post Activities
  ACTIVITIES: {
    POST_CREATED: 1, // Points for creating a post
    POST_VIEWED: 0.1, // Points for viewing a post (0.1 per view)
    COMMENT_CREATED: 1, // Points for creating a comment
    REACTION_GIVEN: 1, // Points for reacting to a post
    FOLLOWER_GAINED: 1, // Points for gaining a follower
    REFERRAL_CONVERTED: 5, // Points for referring a user who signs up
  },

  // Daily Limits (by user tier)
  DAILY_LIMITS: {
    FREE_USER: 100, // Free users can earn max 100 points/day
    PRO_USER: 2000, // Pro users can earn max 2000 points/day
  },

  // Wallet Operations
  WALLET: {
    MONEY_RECEIVED: null, // No points for receiving money
    MONEY_SENT: null, // No points for sending money
    WITHDRAWAL: null, // No points for withdrawal
  },

  // Message/Social
  NOTIFICATIONS: {
    // No points for these, just track notifications
  },
};

module.exports = POINTS_CONFIG;
