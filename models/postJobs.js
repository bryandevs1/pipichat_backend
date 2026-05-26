const db = require('../config/database');

class PostJob {
  static async create(jobData) {
    const {
      post_id, category_id, title, location, salary_minimum, salary_maximum,
      pay_salary_per, type, question_1_type, question_1_title, question_1_choices,
      question_2_type, question_2_title, question_2_choices, question_3_type,
      question_3_title, question_3_choices, cover_image, available
    } = jobData;
    
    const query = `
      INSERT INTO posts_jobs (
        post_id, category_id, title, location, salary_minimum, salary_maximum,
        pay_salary_per, type, question_1_type, question_1_title, question_1_choices,
        question_2_type, question_2_title, question_2_choices, question_3_type,
        question_3_title, question_3_choices, cover_image, available
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const [result] = await db.execute(query, [
      post_id, category_id, title, location, salary_minimum, salary_maximum,
      pay_salary_per, type, question_1_type, question_1_title, question_1_choices,
      question_2_type, question_2_title, question_2_choices, question_3_type,
      question_3_title, question_3_choices, cover_image, available || '1'
    ]);
    
    return result.insertId;
  }

  static async findByPostId(postId) {
    const [rows] = await db.execute('SELECT * FROM posts_jobs WHERE post_id = ?', [postId]);
    return rows[0];
  }
}

module.exports = PostJob;