const db = require('../config/db');

class PostsCollaborativeUsers {
  static async add(postId, userId, collaborativePercent = 0) {
    const [res] = await db.query(
      'INSERT INTO posts_collaborative_users (post_id, user_id, collaborative_percent) VALUES (?, ?, ?)',
      [postId, userId, collaborativePercent]
    );
    return res.insertId;
  }

  static async listByPost(postId) {
    const [rows] = await db.query('SELECT * FROM posts_collaborative_users WHERE post_id = ?', [postId]);
    return rows;
  }
}

module.exports = PostsCollaborativeUsers;
