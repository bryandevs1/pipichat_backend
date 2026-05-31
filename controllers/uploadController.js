const db = require("../config/db");
const storageManager = require("../utils/storageManager");

class UploadController {
  static async getCurrentUserId(req) {
    return req.user?.id || req.user?.user_id || req.user?.uid || null;
  }

  // POST /api/uploads - Upload a file
  static async uploadFile(req, res) {
    try {
      const userId = UploadController.getCurrentUserId(req);
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

      if (!req.file) return res.status(400).json({ success: false, message: "No file provided" });

      const file = req.file;
      file.originalname = `upload-${Date.now()}-${file.originalname}`;
      const uploadResult = await storageManager.upload(file, "users-uploads");

      await db.query(
        `INSERT INTO users_uploads (user_id, source, storage_type, storage_data, filename, created_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [userId, uploadResult.path, uploadResult.storage_type, JSON.stringify(uploadResult.storage_data || {}), file.originalname]
      );

      res.status(201).json({
        success: true,
        url: uploadResult.public_url || uploadResult.path,
        path: uploadResult.path,
      });
    } catch (err) {
      console.error("uploadFile error:", err);
      res.status(500).json({ success: false, message: "Upload failed" });
    }
  }

  // GET /api/uploads - Get user's uploads
  static async getUserUploads(req, res) {
    try {
      const userId = UploadController.getCurrentUserId(req);
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

      const { page = 1, limit = 50 } = req.query;
      const offset = (page - 1) * limit;

      const [uploads] = await db.query(
        "SELECT * FROM users_uploads WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
        [userId, parseInt(limit), parseInt(offset)]
      );
      res.json({ success: true, data: uploads });
    } catch (err) {
      res.status(500).json({ success: false, message: "Failed to fetch uploads" });
    }
  }

  // GET /api/uploads/pending - Get pending uploads
  static async getPendingUploads(req, res) {
    try {
      const userId = UploadController.getCurrentUserId(req);
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

      const [pending] = await db.query(
        "SELECT * FROM users_uploads_pending WHERE user_id = ? ORDER BY created_at DESC",
        [userId]
      );
      res.json({ success: true, data: pending });
    } catch (err) {
      res.status(500).json({ success: false, message: "Failed to fetch pending uploads" });
    }
  }

  // DELETE /api/uploads/:uploadId - Delete an upload
  static async deleteUpload(req, res) {
    try {
      const userId = UploadController.getCurrentUserId(req);
      const { uploadId } = req.params;

      const [[upload]] = await db.query("SELECT * FROM users_uploads WHERE id = ? AND user_id = ?", [uploadId, userId]);
      if (!upload) return res.status(404).json({ success: false, message: "Upload not found" });

      await db.query("DELETE FROM users_uploads WHERE id = ?", [uploadId]);
      res.json({ success: true, message: "Upload deleted" });
    } catch (err) {
      res.status(500).json({ success: false, message: "Failed to delete upload" });
    }
  }
}

module.exports = UploadController;
