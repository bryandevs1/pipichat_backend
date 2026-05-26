

// routes/affiliateRoutes.js
const express = require('express');
const router = express.Router();
const {
  getAffiliateStats,
  requestPayout,
  getReferralLink,
  referralLink,
  withdrawals,
  withdrawPointsToWallet
} = require('../controllers/affiliateController');
const { authenticateToken } = require('../middleware/authMiddleware');

// Middleware to verify authenticated user (you must have this)
const auth = authenticateToken;
// Public: Register with referral (used in auth route usually)
// But you can also expose it here if needed
// router.post('/register', registerWithReferral);

router.get('/stats', auth, getAffiliateStats);
router.post('/withdraw', auth, requestPayout);
router.get('/link', auth, getReferralLink);
router.get('/me/referral-link', auth, referralLink);
router.get('/withdrawal', auth, withdrawals);
router.post('/points/withdraw', auth, withdrawPointsToWallet);

module.exports = router;