// middleware/userActivity.js
const db = require("../config/db");

const updateUserActivity = async (req, res, next) => {
  try {
    const user_id = req.user?.user_id || req.user?.id;
    if (user_id) {
      // Update user_last_seen to track activity for online/offline status
      await db.query(
        "UPDATE users SET user_last_seen = NOW() WHERE user_id = ?",
        [user_id]
      );
    }
    next();
  } catch (error) {
    console.error("Error updating user activity:", error);
    next();
  }
};

module.exports = { updateUserActivity };
