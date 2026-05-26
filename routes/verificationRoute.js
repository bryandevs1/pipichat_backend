const express = require("express");
const router = express.Router();
const {
  createVerificationRequest,
  checkVerificationStatus,
} = require("../controllers/verificationController");

router.post("/upload-verification-documents", createVerificationRequest);
router.get(
  "/check-status/:user_id",
  checkVerificationStatus
);

module.exports = router;

