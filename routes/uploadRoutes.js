const express = require("express");
const router = express.Router();
const multer = require("multer");
const UploadController = require("../controllers/uploadController");
const authMiddleware = require("../middleware/authMiddleware");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

router.get("/", authMiddleware, UploadController.getUserUploads);
router.get("/pending", authMiddleware, UploadController.getPendingUploads);
router.post("/", authMiddleware, upload.single("file"), UploadController.uploadFile);
router.delete("/:uploadId", authMiddleware, UploadController.deleteUpload);

module.exports = router;
