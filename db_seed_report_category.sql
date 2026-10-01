-- Seed the reports_categories row required by reportPost().
--
-- Why this is needed:
--   backend/controllers/postController.js inserts into `reports`, where
--   `category_id` is NOT NULL and references reports_categories. Without a row
--   with category_id = 1, every report fails with a foreign-key/NOT NULL error.
--
-- Background: reportPost() previously targeted a `post_reports` table that does
-- not exist in this schema, so reporting was broken end-to-end. This restores
-- the moderation flow required by App Store Review Guideline 1.2.
--
-- Safe to re-run.

INSERT INTO reports_categories
  (category_id, category_parent_id, category_name, category_description, category_order)
VALUES
  (1, 0, 'General', 'Objectionable content reported by users', 1)
ON DUPLICATE KEY UPDATE
  category_name = VALUES(category_name),
  category_description = VALUES(category_description);
