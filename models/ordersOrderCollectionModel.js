const db = require('../config/db');

class OrdersOrderCollection {
  static async create(orderId, provider, providerOrderId = null, status = 'pending', amount = 0) {
    const [res] = await db.query(
      'INSERT INTO orders_order_collection (order_id, provider, provider_order_id, status, amount, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [orderId, provider, providerOrderId, status, amount]
    );
    return res.insertId;
  }

  static async getByOrder(orderId) {
    const [rows] = await db.query('SELECT * FROM orders_order_collection WHERE order_id = ?', [orderId]);
    return rows;
  }
}

module.exports = OrdersOrderCollection;
