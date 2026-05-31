const db = require('../config/db');

class UsersUploads {
  static async add(userId, source, storageType = null, storageData = null, filename = null) {
    const [res] = await db.query(
      'INSERT INTO users_uploads (user_id, source, storage_type, storage_data, filename, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [userId, source, storageType, storageData, filename]
    );
    return res.insertId;
  }

  static async listByUser(userId, limit = 50, offset = 0) {
    const [rows] = await db.query('SELECT * FROM users_uploads WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', [userId, Number(limit), Number(offset)]);
    return rows;
  }
}

module.exports = UsersUploads;
