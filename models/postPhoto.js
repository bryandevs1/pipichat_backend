const db = require('../config/database');

class PostPhoto {
  static async create(photoData) {
    const { post_id, album_id, source, blur, pinned } = photoData;
    
    const query = `
      INSERT INTO posts_photos (post_id, album_id, source, blur, pinned)
      VALUES (?, ?, ?, ?, ?)
    `;
    
    const [result] = await db.execute(query, [post_id, album_id, source, blur || '0', pinned || '0']);
    return result.insertId;
  }

  static async createMultiple(photosData) {
    const values = photosData.map(photo => [
      photo.post_id, photo.album_id, photo.source, photo.blur || '0', photo.pinned || '0'
    ]);
    
    const query = `
      INSERT INTO posts_photos (post_id, album_id, source, blur, pinned)
      VALUES ?
    `;
    
    const [result] = await db.execute(query, [values]);
    return result.affectedRows;
  }

  static async findByPostId(postId) {
    const [rows] = await db.execute('SELECT * FROM posts_photos WHERE post_id = ?', [postId]);
    return rows;
  }
}

module.exports = PostPhoto;