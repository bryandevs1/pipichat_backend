const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/monetizationController');
const { authenticateToken } = require('../middleware/authMiddleware');

const auth = authenticateToken;

router.get('/settings', auth, ctrl.getSettings);
router.post('/settings', auth, ctrl.updateSettings);
router.get('/plans', auth, ctrl.getPlans);
router.post('/plans/create', auth, ctrl.createPlan);
router.put('/plans/:id', auth, ctrl.updatePlan);
router.delete('/plans/:id', auth, ctrl.deletePlan);
router.post('/subscribe', auth, ctrl.subscribe);
router.post('/unsubscribe', auth, ctrl.unsubscribe);
router.get('/subscribers', auth, ctrl.getSubscribers);
router.get('/balance', auth, ctrl.getBalance);
router.get('/withdrawals', auth, ctrl.getWithdrawals);
router.post('/withdraw/request', auth, ctrl.requestWithdrawal);

module.exports = router;