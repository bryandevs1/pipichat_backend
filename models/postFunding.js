const db = require('../config/database');

class PostFunding {
  static async create(fundingData) {
    const { post_id, title, amount, cover_image, end_date } = fundingData;
    
    const query = `
      INSERT INTO posts_funding (post_id, title, amount, raised_amount, total_donations, cover_image, end_date)
      VALUES (?, ?, ?, 0, 0, ?, ?)
    `;
    
    const [result] = await db.execute(query, [post_id, title, amount, cover_image, end_date]);
    return result.insertId;
  }

  static async findByPostId(postId) {
    const [rows] = await db.execute('SELECT * FROM posts_funding WHERE post_id = ?', [postId]);
    return rows[0];
  }
}

module.exports = PostFunding;