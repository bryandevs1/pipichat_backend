const db = require('../config/db');

class PostsCourses {
  static async create(postId, title, description = null, price = 0) {
    const [res] = await db.query(
      'INSERT INTO posts_courses (post_id, title, description, price, created_at) VALUES (?, ?, ?, ?, NOW())',
      [postId, title, description, price]
    );
    return res.insertId;
  }

  static async getByPost(postId) {
    const [rows] = await db.query('SELECT * FROM posts_courses WHERE post_id = ? LIMIT 1', [postId]);
    return rows[0] || null;
  }
}

module.exports = PostsCourses;
