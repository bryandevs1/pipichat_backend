const db = require('../config/database');

class PostOffer {
  static async create(offerData) {
    const {
      post_id, category_id, title, discount_type, discount_percent, discount_amount,
      buy_x, get_y, spend_x, amount_y, end_date, price, thumbnail
    } = offerData;
    
    const query = `
      INSERT INTO posts_offers (
        post_id, category_id, title, discount_type, discount_percent, discount_amount,
        buy_x, get_y, spend_x, amount_y, end_date, price, thumbnail
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const [result] = await db.execute(query, [
      post_id, category_id, title, discount_type, discount_percent, discount_amount,
      buy_x, get_y, spend_x, amount_y, end_date, price, thumbnail
    ]);
    
    return result.insertId;
  }

  static async findByPostId(postId) {
    const [rows] = await db.execute('SELECT * FROM posts_offers WHERE post_id = ?', [postId]);
    return rows[0];
  }
}

module.exports = PostOffer;