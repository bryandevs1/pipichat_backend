const db = require('../config/db');

class MonetizationCouponsUsers {
  static async redeem(couponId, userId, orderId = null) {
    const [res] = await db.query(
      'INSERT INTO monetization_coupons_users (coupon_id, user_id, order_id, created_at) VALUES (?, ?, ?, NOW())',
      [couponId, userId, orderId]
    );
    return res.insertId;
  }

  static async listByUser(userId) {
    const [rows] = await db.query('SELECT * FROM monetization_coupons_users WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    return rows;
  }
}

module.exports = MonetizationCouponsUsers;
