const db = require('../config/db');

class PagesInvites {
  static async invite(pageId, userId, inviterId, status = 'pending') {
    const [res] = await db.query(
      'INSERT INTO pages_invites (page_id, user_id, inviter_id, status, created_at) VALUES (?, ?, ?, ?, NOW())',
      [pageId, userId, inviterId, status]
    );
    return res.insertId;
  }

  static async listForPage(pageId) {
    const [rows] = await db.query('SELECT * FROM pages_invites WHERE page_id = ?', [pageId]);
    return rows;
  }
}

module.exports = PagesInvites;
