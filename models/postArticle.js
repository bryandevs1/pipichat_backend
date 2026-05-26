const db = require('../config/database');

class PostArticle {
  static async create(articleData) {
    const { post_id, cover, title, text, category_id, tags } = articleData;
    
    const query = `
      INSERT INTO posts_articles (post_id, cover, title, text, category_id, tags)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    
    const [result] = await db.execute(query, [post_id, cover, title, text, category_id, tags]);
    return result.insertId;
  }

  static async findByPostId(postId) {
    const [rows] = await db.execute('SELECT * FROM posts_articles WHERE post_id = ?', [postId]);
    return rows[0];
  }
}

module.exports = PostArticle;