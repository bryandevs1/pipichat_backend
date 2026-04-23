// routes/walletRoutes.js
const express = require("express");
const router = express.Router();
const walletController = require("../controllers/walletController");
const { authenticateToken } = require("../middleware/authMiddleware");

const auth = authenticateToken;

router.post("/initialize", walletController.initializePayment);
router.post("/webhook", walletController.verifyPayment);
router.get("/balance/:userId", walletController.getBalance);
router.post("/convert/:userId", walletController.convertToWallet);
router.post("/send", walletController.sendMoney);
router.get("/transactions/:userId", walletController.getTransactions);
router.get("/search-users", auth, walletController.searchUsers);
router.get(
  "/recent-transaction-users/:userId",
  walletController.recentTransactionUsers,
);
router.get("/fund/config", walletController.getWalletFundingConfig);
router.post("/fund/webhook", walletController.verifyWalletFunding);
router.get("/fund/callback", walletController.handlePaystackCallback);
// Protected routes
router.post(
  "/fund/initialize",
  authenticateToken,
  walletController.initializeWalletFunding,
);
router.post("/test-credit", authenticateToken, walletController.testCredit);
module.exports = router;
