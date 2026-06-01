const db = require('../config/db');

class PostsReels {
  static async create(postId, source, thumbnail = null) {
    const [res] = await db.query(
      'INSERT INTO posts_reels (post_id, source, thumbnail) VALUES (?, ?, ?)',
      [postId, source, thumbnail]
    );
    return res.insertId;
  }

  static async getByPost(postId) {
    const [rows] = await db.query('SELECT * FROM posts_reels WHERE post_id = ? LIMIT 1', [postId]);
    return rows[0] || null;
  }
}

module.exports = PostsReels;
