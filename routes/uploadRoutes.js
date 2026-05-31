const express = require("express");
const router = express.Router();
const multer = require("multer");
const UploadController = require("../controllers/uploadController");
const { authenticateToken } = require("../middleware/authMiddleware");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

router.get("/", authenticateToken, UploadController.getUserUploads);
router.get("/pending", authenticateToken, UploadController.getPendingUploads);
router.post("/", authenticateToken, upload.single("file"), UploadController.uploadFile);
router.delete("/:uploadId", authenticateToken, UploadController.deleteUpload);

module.exports = router;
