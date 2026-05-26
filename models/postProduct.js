const db = require('../config/database');

class PostProduct {
  static async create(productData) {
    const {
      post_id, name, price, quantity, category_id, status, location,
      available, is_digital, product_download_url, product_file_source
    } = productData;
    
    const query = `
      INSERT INTO posts_products (
        post_id, name, price, quantity, category_id, status, location,
        available, is_digital, product_download_url, product_file_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const [result] = await db.execute(query, [
      post_id, name, price, quantity, category_id, status || 'new', location,
      available || '1', is_digital || '0', product_download_url, product_file_source
    ]);
    
    return result.insertId;
  }

  static async findByPostId(postId) {
    const [rows] = await db.execute('SELECT * FROM posts_products WHERE post_id = ?', [postId]);
    return rows[0];
  }
}

module.exports = PostProduct;