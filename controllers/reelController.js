const db = require("../config/db");
const storageManager = require("../utils/storageManager");

class ReelController {
  static async getCurrentUserId(req) {
    return req.user?.id || req.user?.user_id || req.user?.uid || null;
  }

  // GET /api/reels - Get reels with pagination
  static async getReels(req, res) {
    try {
      const userId = await ReelController.getCurrentUserId(req);
      const { page = 1, limit = 20, category_id } = req.query;
      const offset = (page - 1) * limit;

      // Use 0 as fallback — no real user has user_id = 0, so LEFT JOIN produces NULL
      const effectiveUserId = userId || 0;

      let query = `
        SELECT p.*, pr.source, pr.thumbnail,
               u.user_name, u.user_firstname, u.user_picture, u.user_verified,
               pv.category_id,
               prr.reaction AS user_reaction
        FROM posts_reels pr
        JOIN posts p ON pr.post_id = p.post_id
        LEFT JOIN users u ON p.user_id = u.user_id AND p.user_type = 'user'
        LEFT JOIN posts_videos pv ON pv.post_id = p.post_id
        LEFT JOIN posts_reactions prr ON prr.post_id = p.post_id AND prr.user_id = ?
        WHERE p.is_hidden = '0' AND p.has_approved = '1'
      `;
      const params = [effectiveUserId];

      if (category_id) {
        query += ` AND pv.category_id = ?`;
        params.push(category_id);
      }

      query += ` ORDER BY p.time DESC LIMIT ? OFFSET ?`;
      params.push(parseInt(limit), parseInt(offset));

      const [reels] = await db.query(query, params);
      res.json({ success: true, data: reels });
    } catch (err) {
      console.error("getReels error:", err);
      res.status(500).json({ success: false, message: "Failed to fetch reels" });
    }
  }

  // GET /api/reels/:postId - Get single reel
  static async getReel(req, res) {
    try {
      const userId = await ReelController.getCurrentUserId(req);
      const effectiveUserId = userId || 0;
      const { postId } = req.params;
      const [reels] = await db.query(
        `SELECT p.*, pr.source, pr.thumbnail,
                u.user_name, u.user_firstname, u.user_picture, u.user_verified,
                prr.reaction AS user_reaction
         FROM posts_reels pr
         JOIN posts p ON pr.post_id = p.post_id
         LEFT JOIN users u ON p.user_id = u.user_id AND u.user_type = 'user'
         LEFT JOIN posts_reactions prr ON prr.post_id = p.post_id AND prr.user_id = ?
         WHERE pr.post_id = ?`,
        [effectiveUserId, postId]
      );
      if (reels.length === 0) return res.status(404).json({ success: false, message: "Reel not found" });
      res.json({ success: true, data: reels[0] });
    } catch (err) {
      res.status(500).json({ success: false, message: "Failed to fetch reel" });
    }
  }

  // DELETE /api/reels/:postId - Delete reel
  static async deleteReel(req, res) {
    try {
      const { postId } = req.params;
      const userId = await ReelController.getCurrentUserId(req);
      const [[post]] = await db.query("SELECT user_id FROM posts WHERE post_id = ?", [postId]);
      if (!post || post.user_id !== userId) {
        return res.status(403).json({ success: false, message: "Unauthorized" });
      }
      await db.query("DELETE FROM posts_reels WHERE post_id = ?", [postId]);
      await db.query("UPDATE posts SET is_hidden = '1' WHERE post_id = ?", [postId]);
      res.json({ success: true, message: "Reel deleted" });
    } catch (err) {
      res.status(500).json({ success: false, message: "Failed to delete reel" });
    }
  }
}

module.exports = ReelController;
