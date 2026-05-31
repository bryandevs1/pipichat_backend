const db = require('../config/db');

class CoursesCategories {
  static async create(name, parentId = 0, description = '', order = 1) {
    const [res] = await db.query(
      'INSERT INTO courses_categories (category_parent_id, category_name, category_description, category_order) VALUES (?, ?, ?, ?)',
      [parentId, name, description, order]
    );
    return res.insertId;
  }

  static async list() {
    const [rows] = await db.query('SELECT * FROM courses_categories ORDER BY category_order ASC');
    return rows;
  }
}

module.exports = CoursesCategories;
