const db = require('../config/database');

class PostLive {
  static async create(liveData) {
    const {
      post_id, video_thumbnail, agora_uid, agora_channel_name,
      agora_resource_id, agora_sid, agora_file
    } = liveData;
    
    const query = `
      INSERT INTO posts_live (
        post_id, video_thumbnail, agora_uid, agora_channel_name,
        agora_resource_id, agora_sid, agora_file, live_ended, live_recorded
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '0', '0')
    `;
    
    const [result] = await db.execute(query, [
      post_id, video_thumbnail, agora_uid, agora_channel_name,
      agora_resource_id, agora_sid, agora_file
    ]);
    
    return result.insertId;
  }

  static async findByPostId(postId) {
    const [rows] = await db.execute('SELECT * FROM posts_live WHERE post_id = ?', [postId]);
    return rows[0];
  }
}

module.exports = PostLive;