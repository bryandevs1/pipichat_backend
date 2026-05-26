const db = require('../config/database');

class PostPoll {
  static async create(pollData) {
    const { post_id, options } = pollData;
    
    // Create poll
    const query = `INSERT INTO posts_polls (post_id, votes) VALUES (?, 0)`;
    const [result] = await db.execute(query, [post_id]);
    const pollId = result.insertId;
    
    // Create options
    if (options && options.length > 0) {
      await this.createOptions(pollId, options);
    }
    
    return pollId;
  }

  static async createOptions(pollId, options) {
    const values = options.map(option => [pollId, option.text]);
    const query = 'INSERT INTO posts_polls_options (poll_id, text) VALUES ?';
    const [result] = await db.execute(query, [values]);
    return result.affectedRows;
  }

  static async findByPostId(postId) {
    const [rows] = await db.execute(`
      SELECT p.*, GROUP_CONCAT(po.text) as options 
      FROM posts_polls p 
      LEFT JOIN posts_polls_options po ON p.poll_id = po.poll_id 
      WHERE p.post_id = ? 
      GROUP BY p.poll_id
    `, [postId]);
    return rows[0];
  }
}

module.exports = PostPoll;