const db = require('../config/db');

class PostsCache {
  static async set(postId, key, data) {
    const json = typeof data === 'string' ? data : JSON.stringify(data);
    const [res] = await db.query(
      'INSERT INTO posts_cache (post_id, `key`, `value`, created_at) VALUES (?, ?, ?, NOW())',
      [postId, key, json]
    );
    return res.insertId;
  }

  static async get(postId, key) {
    const [rows] = await db.query('SELECT `value` FROM posts_cache WHERE post_id = ? AND `key` = ? ORDER BY created_at DESC LIMIT 1', [postId, key]);
    if (!rows || rows.length === 0) return null;
    try { return JSON.parse(rows[0].value); } catch(e) { return rows[0].value; }
  }
}

module.exports = PostsCache;
