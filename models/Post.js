const db = require('../config/db');

class Post {
  // Create main post
  static async create(postData) {
    const {
      user_id, user_type, in_group, group_id, group_approved, in_event, event_id, event_approved,
      in_wall, wall_id, post_type, colored_pattern, origin_id, time, location, privacy, text,
      feeling_action, feeling_value, boosted, boosted_by, comments_disabled, is_hidden,
      for_adult, is_anonymous, tips_enabled, for_subscriptions, is_paid, post_price, paid_text
    } = postData;

    const query = `
      INSERT INTO posts (
        user_id, user_type, in_group, group_id, group_approved, in_event, event_id, event_approved,
        in_wall, wall_id, post_type, colored_pattern, origin_id, time, location, privacy, text,
        feeling_action, feeling_value, boosted, boosted_by, comments_disabled, is_hidden,
        for_adult, is_anonymous, tips_enabled, for_subscriptions, is_paid, post_price, paid_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await db.execute(query, [
      user_id, user_type, in_group || '0', group_id, group_approved || '1', in_event || '0', event_id, event_approved || '1',
      in_wall || '0', wall_id, post_type, colored_pattern, origin_id, time || new Date(), location, privacy || 'public', text,
      feeling_action, feeling_value, boosted || '0', boosted_by, comments_disabled || '0', is_hidden || '0',
      for_adult || '0', is_anonymous || '0', tips_enabled || '0', for_subscriptions || '0', is_paid || '0', post_price || 0, paid_text
    ]);

    return result.insertId;
  }

  // Find post by ID
  static async findById(postId) {
    const [rows] = await db.execute('SELECT * FROM posts WHERE post_id = ?', [postId]);
    return rows[0];
  }

  // Update post
  static async update(postId, updateData) {
    const fields = Object.keys(updateData).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updateData);
    values.push(postId);

    const query = `UPDATE posts SET ${fields} WHERE post_id = ?`;
    const [result] = await db.execute(query, values);
    return result;
  }

  // Delete post
  static async delete(postId) {
    const [result] = await db.execute('DELETE FROM posts WHERE post_id = ?', [postId]);
    return result;
  }
}

module.exports = Post;