const db = require('../config/db');

class GroupsInvites {
  static async invite(groupId, userId, inviterId, status = 'pending') {
    const [res] = await db.query(
      'INSERT INTO groups_invites (group_id, user_id, inviter_id, status, created_at) VALUES (?, ?, ?, ?, NOW())',
      [groupId, userId, inviterId, status]
    );
    return res.insertId;
  }

  static async listForGroup(groupId) {
    const [rows] = await db.query('SELECT * FROM groups_invites WHERE group_id = ?', [groupId]);
    return rows;
  }
}

module.exports = GroupsInvites;
