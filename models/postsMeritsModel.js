const db = require('../config/db');

class PostsMerits {
  static async add(postId, reason = null, points = 0, awardedTo = null, awardedBy = null) {
    const [res] = await db.query(
      'INSERT INTO posts_merits (post_id, reason, points, awarded_to, awarded_by, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [postId, reason, points, awardedTo, awardedBy]
    );
    return res.insertId;
  }

  static async listByPost(postId) {
    const [rows] = await db.query('SELECT * FROM posts_merits WHERE post_id = ?', [postId]);
    return rows;
  }
}

module.exports = PostsMerits;
