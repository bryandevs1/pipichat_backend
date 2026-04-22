const db = require("../config/db");

// Block a user
exports.blockUser = async (req, res) => {
  const { user_id } = req.params;
  const { blocked_id } = req.body;

  if (!blocked_id) {
    return res
      .status(400)
      .json({ success: false, message: "Blocked user ID is required" });
  }

  try {
    await db.query(
      "INSERT INTO users_blocks (user_id, blocked_id) VALUES (?, ?)",
      [user_id, blocked_id]
    );
    res.json({ success: true, message: "User blocked successfully" });
  } catch (error) {
    console.error("[ERROR] Failed to block user:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Unblock a user
exports.unblockUser = async (req, res) => {
  const { user_id, blocked_id } = req.params;

  try {
    const [result] = await db.query(
      "DELETE FROM users_blocks WHERE user_id = ? AND blocked_id = ?",
      [user_id, blocked_id]
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found in blocked list" });
    }

    res.json({ success: true, message: "User unblocked successfully" });
  } catch (error) {
    console.error("[ERROR] Failed to unblock user:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Get blocked users list with details
exports.getBlockedUsers = async (req, res) => {
  const { user_id } = req.params;

  try {
    const [rows] = await db.query(
      `
      SELECT u.user_id, u.user_name, u.user_firstname, u.user_lastname, u.user_picture 
      FROM users_blocks ub 
      JOIN users u ON ub.blocked_id = u.user_id 
      WHERE ub.user_id = ?
    `,
      [user_id]
    );

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error("[ERROR] Failed to retrieve blocked users:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
