const db = require('../config/db');

class ConversationsMessagesReactions {
  static async addReaction(messageId, userId, reaction = 'like') {
    const [res] = await db.query(
      'INSERT INTO conversations_messages_reactions (message_id, user_id, reaction, reaction_time) VALUES (?, ?, ?, NOW())',
      [messageId, userId, reaction]
    );
    return res.insertId;
  }

  static async listForMessage(messageId) {
    const [rows] = await db.query('SELECT * FROM conversations_messages_reactions WHERE message_id = ? ORDER BY reaction_time DESC', [messageId]);
    return rows;
  }
}

module.exports = ConversationsMessagesReactions;
