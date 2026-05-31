const db = require("../config/db");

class CourseController {
  static async getCurrentUserId(req) {
    return req.user?.id || req.user?.user_id || req.user?.uid || null;
  }

  // GET /api/courses - Get all courses
  static async getCourses(req, res) {
    try {
      const { page = 1, limit = 20, category_id } = req.query;
      const offset = (page - 1) * limit;

      let query = `
        SELECT pc.*, p.text, p.time, p.user_id,
               u.user_name, u.user_firstname, u.user_picture, u.user_verified,
               cc.category_name
        FROM posts_courses pc
        JOIN posts p ON pc.post_id = p.post_id
        LEFT JOIN users u ON p.user_id = u.user_id AND p.user_type = 'user'
        LEFT JOIN courses_categories cc ON cc.category_id = ?
        WHERE p.is_hidden = '0' AND p.has_approved = '1'
      `;
      const params = [null];

      if (category_id) {
        query = query.replace("LEFT JOIN courses_categories cc ON cc.category_id = ?", "LEFT JOIN courses_categories cc ON cc.category_id = ?");
        params[0] = category_id;
        query += ` AND cc.category_id = ?`;
        params.push(category_id);
      }

      query += ` ORDER BY pc.created_at DESC LIMIT ? OFFSET ?`;
      params.push(parseInt(limit), parseInt(offset));

      const [courses] = await db.query(query, params);
      res.json({ success: true, data: courses });
    } catch (err) {
      console.error("getCourses error:", err);
      res.status(500).json({ success: false, message: "Failed to fetch courses" });
    }
  }

  // GET /api/courses/:courseId/applications - Get applications for a course
  static async getApplications(req, res) {
    try {
      const { courseId } = req.params;
      const userId = CourseController.getCurrentUserId(req);

      const [[course]] = await db.query(
        `SELECT pc.post_id FROM posts_courses pc JOIN posts p ON pc.post_id = p.post_id WHERE pc.course_id = ? AND p.user_id = ?`,
        [courseId, userId]
      );
      if (!course) return res.status(403).json({ success: false, message: "Unauthorized" });

      const [applications] = await db.query(
        `SELECT pca.*, u.user_name, u.user_firstname, u.user_picture, u.user_email
         FROM posts_courses_applications pca
         LEFT JOIN users u ON pca.user_id = u.user_id
         WHERE pca.course_id = ?
         ORDER BY pca.created_at DESC`,
        [courseId]
      );
      res.json({ success: true, data: applications });
    } catch (err) {
      res.status(500).json({ success: false, message: "Failed to fetch applications" });
    }
  }

  // POST /api/courses/:courseId/apply - Apply for a course
  static async applyForCourse(req, res) {
    try {
      const { courseId } = req.params;
      const userId = CourseController.getCurrentUserId(req);
      const { message } = req.body;

      const [[course]] = await db.query("SELECT * FROM posts_courses WHERE course_id = ?", [courseId]);
      if (!course) return res.status(404).json({ success: false, message: "Course not found" });

      const [existing] = await db.query(
        "SELECT 1 FROM posts_courses_applications WHERE course_id = ? AND user_id = ?",
        [courseId, userId]
      );
      if (existing.length > 0) return res.status(400).json({ success: false, message: "Already applied" });

      await db.query(
        "INSERT INTO posts_courses_applications (course_id, user_id, message, created_at) VALUES (?, ?, ?, NOW())",
        [courseId, userId, message || null]
      );

      res.json({ success: true, message: "Application submitted" });
    } catch (err) {
      res.status(500).json({ success: false, message: "Failed to apply" });
    }
  }

  // GET /api/courses/categories - Get course categories
  static async getCategories(req, res) {
    try {
      const [categories] = await db.query("SELECT * FROM courses_categories ORDER BY category_order ASC");
      res.json({ success: true, data: categories });
    } catch (err) {
      res.status(500).json({ success: false, message: "Failed to fetch categories" });
    }
  }
}

module.exports = CourseController;
