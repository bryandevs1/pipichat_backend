const db = require('../config/db');

class PostsReels {
  static async create(postId, reelUrl, thumb = null, duration = null) {
    const [res] = await db.query(
      'INSERT INTO posts_reels (post_id, reel_url, thumb, duration, created_at) VALUES (?, ?, ?, ?, NOW())',
      [postId, reelUrl, thumb, duration]
    );
    return res.insertId;
  }

  static async getByPost(postId) {
    const [rows] = await db.query('SELECT * FROM posts_reels WHERE post_id = ? LIMIT 1', [postId]);
    return rows[0] || null;
  }
}

module.exports = PostsReels;
