const express = require("express");
const {
  login,
  signup,
  verifyEmail,
  resendVerificationCode,
  requestPasswordReset,
  resetPassword,
  validateResetKey,
  me,
  refreshToken,
  completeOnboarding,
  verify2FALogin,
} = require("../controllers/authController");

const { authenticateToken } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/login", login);
router.post("/signup", signup);
router.post("/complete-onboarding", authenticateToken, completeOnboarding);

router.post("/verify-email", verifyEmail);
router.post("/resend-verification-code", resendVerificationCode);
router.post("/request-password-reset", requestPasswordReset);
router.post("/validate-reset-key", validateResetKey);
router.put("/reset-password", resetPassword);
router.post("/verify-2fa-login", verify2FALogin);
router.post("/refresh", refreshToken);
router.get("/me", authenticateToken, me);

module.exports = router;
