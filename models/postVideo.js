const db = require('../config/database');

class PostVideo {
  static async create(videoData) {
    const {
      post_id, source, source_240p, source_360p, source_480p, source_720p,
      source_1080p, source_1440p, source_2160p, thumbnail, category_id
    } = videoData;
    
    const query = `
      INSERT INTO posts_videos (
        post_id, source, source_240p, source_360p, source_480p, source_720p,
        source_1080p, source_1440p, source_2160p, thumbnail, category_id, views
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `;
    
    const [result] = await db.execute(query, [
      post_id, source, source_240p, source_360p, source_480p, source_720p,
      source_1080p, source_1440p, source_2160p, thumbnail, category_id
    ]);
    
    return result.insertId;
  }

  static async findByPostId(postId) {
    const [rows] = await db.execute('SELECT * FROM posts_videos WHERE post_id = ?', [postId]);
    return rows[0];
  }
}

module.exports = PostVideo;