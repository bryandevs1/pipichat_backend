const db = require('../config/db');

class PostsCoursesApplications {
  static async apply(courseId, userId, message = null) {
    const [res] = await db.query(
      'INSERT INTO posts_courses_applications (course_id, user_id, message, created_at) VALUES (?, ?, ?, NOW())',
      [courseId, userId, message]
    );
    return res.insertId;
  }

  static async listByCourse(courseId) {
    const [rows] = await db.query('SELECT * FROM posts_courses_applications WHERE course_id = ? ORDER BY created_at DESC', [courseId]);
    return rows;
  }
}

module.exports = PostsCoursesApplications;
