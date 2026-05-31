const db = require('../config/db');

class PostsArticlesReferences {
  static async add(postId, referencePostId) {
    const [res] = await db.query(
      'INSERT INTO posts_articles_references (post_id, reference_post_id, created_at) VALUES (?, ?, NOW())',
      [postId, referencePostId]
    );
    return res.insertId;
  }

  static async listByPost(postId) {
    const [rows] = await db.query('SELECT * FROM posts_articles_references WHERE post_id = ?', [postId]);
    return rows;
  }
}

module.exports = PostsArticlesReferences;
