const db = require('../config/db');

class UsersUploadsPending {
  static async add(userId, source, storageType = null, storageData = null, filename = null) {
    const [res] = await db.query(
      'INSERT INTO users_uploads_pending (user_id, source, storage_type, storage_data, filename, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [userId, source, storageType, storageData, filename]
    );
    return res.insertId;
  }

  static async listByUser(userId, limit = 50) {
    const [rows] = await db.query('SELECT * FROM users_uploads_pending WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, Number(limit)]);
    return rows;
  }
}

module.exports = UsersUploadsPending;
