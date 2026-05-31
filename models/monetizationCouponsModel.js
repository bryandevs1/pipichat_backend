const db = require('../config/db');

class MonetizationCoupons {
  static async create(code, title = null, description = null, type = 'amount', value = 0, expireAt = null) {
    const [res] = await db.query(
      'INSERT INTO monetization_coupons (code, title, description, discount_type, discount_value, expire_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [code, title, description, type, value, expireAt]
    );
    return res.insertId;
  }

  static async getByCode(code) {
    const [rows] = await db.query('SELECT * FROM monetization_coupons WHERE code = ? LIMIT 1', [code]);
    return rows[0] || null;
  }
}

module.exports = MonetizationCoupons;
