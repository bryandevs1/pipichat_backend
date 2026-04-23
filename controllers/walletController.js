// controllers/walletController.js
const PaystackService = require("../services/PaystackService");
const WalletService = require("../services/WalletService");
const rawBody = require("../middleware/rawBody");
const db = require("../config/db");
const NotificationService = require("../services/notificationService");
const axios = require("axios");
const crypto = require("node:crypto");
const { getFullUserProfileUrl } = require("../utils/urlNormalizer");

const WALLET_FUNDING_CONFIG = {
  min_amount: 100,
  max_amount: 5000000,
  fee_rate: 0.015,
  fixed_fee: 100,
  max_fee: 2000,
  currency: "NGN",
};

const calculateWalletFundingFee = (amount) => {
  const numAmount = Number(amount) || 0;
  if (numAmount <= 0) return 0;

  const rawFee =
    numAmount * WALLET_FUNDING_CONFIG.fee_rate +
    WALLET_FUNDING_CONFIG.fixed_fee;
  return Math.min(rawFee, WALLET_FUNDING_CONFIG.max_fee);
};

const processWalletFundingCredit = async ({ userId, baseAmount, ref }) => {
  const lockName = `wallet_funding_${ref}`;
  const description = `Wallet funded via Paystack | Ref: ${ref}`;

  const [lockRows] = await db.query("SELECT GET_LOCK(?, 10) AS lock_acquired", [
    lockName,
  ]);
  const lockAcquired = Number(lockRows?.[0]?.lock_acquired) === 1;

  if (!lockAcquired) {
    console.warn("⚠️ Unable to acquire wallet funding lock", {
      userId,
      ref,
      lockName,
    });
    return { credited: false, alreadyProcessed: true, locked: false };
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [existing] = await connection.query(
      `SELECT transaction_id FROM wallet_transactions
       WHERE user_id = ? AND node_type = 'recharge' AND description LIKE ?
       LIMIT 1`,
      [userId, `%Ref: ${ref}%`],
    );

    if (existing.length > 0) {
      await connection.rollback();
      return { credited: false, alreadyProcessed: true, locked: true };
    }

    await connection.query(
      `UPDATE users SET user_wallet_balance = user_wallet_balance + ? WHERE user_id = ?`,
      [baseAmount, userId],
    );

    await connection.query(
      `INSERT INTO wallet_transactions
       (user_id, node_type, amount, type, date, description)
       VALUES (?, 'recharge', ?, 'in', NOW(), ?)`,
      [userId, baseAmount, description],
    );

    await NotificationService.createNotification(
      userId,
      userId,
      "wallet_payment",
      `Your wallet was funded with ₦${Number(baseAmount).toFixed(2)}`,
      "wallet",
      userId,
      "/wallet",
    );

    await connection.commit();
    return { credited: true, alreadyProcessed: false, locked: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    try {
      await db.query("SELECT RELEASE_LOCK(?)", [lockName]);
    } catch (releaseError) {
      console.warn("⚠️ Failed to release wallet funding lock", {
        ref,
        message: releaseError?.message,
      });
    }
  }
};

exports.getWalletFundingConfig = async (_req, res) => {
  return res.json({
    success: true,
    data: {
      ...WALLET_FUNDING_CONFIG,
      fee_formula: `${WALLET_FUNDING_CONFIG.fee_rate * 100}% + ₦${WALLET_FUNDING_CONFIG.fixed_fee} (capped at ₦${WALLET_FUNDING_CONFIG.max_fee})`,
    },
  });
};

exports.initializePayment = async (req, res) => {
  try {
    const { userId, amount, email } = req.body;
    if (!amount || amount < 100)
      return res.status(400).json({ error: "Minimum ₦100" });

    const authUrl = await PaystackService.initializePayment({
      email,
      amount,
      userId,
    });
    res.json({ authorization_url: authUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.verifyPayment = [
  rawBody,
  async (req, res) => {
    try {
      const signature = req.headers["x-paystack-signature"];
      const payment = await PaystackService.verifyPayment(
        req.rawBody,
        signature,
      );
      if (!payment) return res.status(200).send("Ignored");

      await WalletService.creditWallet(
        payment.userId,
        payment.amount,
        `Paystack deposit - Ref: ${payment.reference}`,
      );

      await NotificationService.createNotification(
        payment.userId,
        payment.userId,
        "wallet_payment",
        `Your wallet was funded with ₦${Number(payment.amount).toFixed(2)}`,
        "wallet",
        payment.userId,
        "/wallet",
      );

      res.status(200).send("OK");
    } catch (err) {
      console.error("Webhook error:", err.message);
      res.status(400).send("Failed");
    }
  },
];

exports.getBalance = async (req, res) => {
  const { userId } = req.params;
  try {
    const main = await WalletService.getBalance(userId, "main");
    const affiliate = await WalletService.getBalance(userId, "affiliate");
    const points = await WalletService.getBalance(userId, "points");
    const funding = await WalletService.getBalance(userId, "funding");

    res.json({ main, affiliate, points, funding });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.convertToWallet = async (req, res) => {
  const { userId } = req.params;
  const { amount, source } = req.body;

  try {
    await WalletService.convertToWallet(userId, amount, source);

    await NotificationService.createNotification(
      userId,
      userId,
      "wallet_payment",
      `₦${Number(amount).toFixed(2)} was added to your wallet from ${source}`,
      "wallet",
      userId,
      "/wallet",
    );

    res.json({ message: `${source} converted to wallet`, amount });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.sendMoney = async (req, res) => {
  const { senderId, recipientId, amount } = req.body;
  try {
    // Get sender details for notification
    const [senderRows] = await db.query(
      `SELECT user_firstname, user_lastname, user_name FROM users WHERE user_id = ?`,
      [senderId],
    );

    const senderName = senderRows[0]
      ? `${senderRows[0].user_firstname || ""} ${senderRows[0].user_lastname || ""}`.trim() ||
        senderRows[0].user_name
      : "Someone";

    // Transfer money
    await WalletService.transfer(senderId, recipientId, amount);

    // ✅ Create notification for recipient (includes Socket.IO emit and FCM push)
    await NotificationService.createNotification(
      recipientId,
      senderId,
      "wallet_transfer",
      `${senderName} sent you ₦${Number(amount).toFixed(2)}`,
      "wallet",
      senderId,
      `/wallet`,
    );

    res.json({ message: "Transfer successful" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getTransactions = async (req, res) => {
  const { userId } = req.params;
  const transactions = await WalletService.getTransactions(userId);
  const normalizedTransactions = transactions.map((tx) => ({
    ...tx,
    counterparty_picture: getFullUserProfileUrl(tx.counterparty_picture),
  }));

  res.json({ transactions: normalizedTransactions });
};

exports.searchUsers = async (req, res) => {
  const { query } = req.query;
  const currentUserId = req.user.id;

  const [users] = await db.query(
    `SELECT user_id, user_name, user_firstname, user_lastname, user_picture 
     FROM users 
     WHERE (user_name LIKE ? OR user_email LIKE ?)
     AND user_id != ?
     LIMIT 20`,
    [`%${query}%`, `%${query}%`, currentUserId],
  );

  const normalizedUsers = users.map((user) => ({
    ...user,
    user_picture: getFullUserProfileUrl(user.user_picture),
  }));

  res.json({ users: normalizedUsers });
};

// Add this to your wallet routes (backend)
exports.recentTransactionUsers = async (req, res) => {
  try {
    const userId = req.params.userId;
    const limit = Number.parseInt(req.query.limit) || 5;

    const [rows] = await db.query(
      `SELECT DISTINCT
        CASE 
          WHEN t.user_id = ? THEN u2.user_id
          ELSE u1.user_id
        END AS user_id,
        CASE 
          WHEN t.user_id = ? THEN u2.user_name
          ELSE u1.user_name
        END AS user_name,
        CASE 
          WHEN t.user_id = ? THEN u2.user_firstname
          ELSE u1.user_firstname
        END AS user_firstname,
        CASE 
          WHEN t.user_id = ? THEN u2.user_lastname
          ELSE u1.user_lastname
        END AS user_lastname,
        CASE 
          WHEN t.user_id = ? THEN u2.user_picture
          ELSE u1.user_picture
        END AS user_picture,
        MAX(t.date) as last_transaction_date
        
      FROM wallet_transactions t
      LEFT JOIN users u1 ON t.user_id = u1.user_id
      LEFT JOIN users u2 ON t.node_id = u2.user_id
      WHERE (t.user_id = ? OR t.node_id = ?)
        AND t.node_type = 'user'
        AND (t.user_id != ? OR t.node_id != ?)  -- Exclude self-transactions
      GROUP BY 
        CASE 
          WHEN t.user_id = ? THEN u2.user_id
          ELSE u1.user_id
        END,
        CASE 
          WHEN t.user_id = ? THEN u2.user_name
          ELSE u1.user_name
        END,
        CASE 
          WHEN t.user_id = ? THEN u2.user_firstname
          ELSE u1.user_firstname
        END,
        CASE 
          WHEN t.user_id = ? THEN u2.user_lastname
          ELSE u1.user_lastname
        END,
        CASE 
          WHEN t.user_id = ? THEN u2.user_picture
          ELSE u1.user_picture
        END
      ORDER BY last_transaction_date DESC
      LIMIT ?`,
      [
        userId,
        userId,
        userId,
        userId,
        userId, // for CASE conditions
        userId,
        userId, // for WHERE conditions
        userId,
        userId, // exclude self
        userId,
        userId,
        userId,
        userId,
        userId, // for GROUP BY
        limit,
      ],
    );

    // Filter out null users and current user
    const recentUsers = rows
      .filter((user) => user.user_id && user.user_id != userId)
      .map((user) => ({
        user_id: user.user_id,
        user_name: user.user_name,
        user_firstname: user.user_firstname,
        user_lastname: user.user_lastname,
        user_picture: getFullUserProfileUrl(user.user_picture),
      }));

    res.json({ users: recentUsers });
  } catch (error) {
    console.error("Error fetching recent transaction users:", error);
    res.status(500).json({ error: "Failed to fetch recent users" });
  }
};

// === INITIALIZE PAYSTACK PAYMENT ===
// controllers/walletController.js or wherever you have it
exports.initializeWalletFunding = async (req, res) => {
  const userId = req.user.id;
  const { amount } = req.body;

  const numAmount = Number.parseFloat(amount);
  if (!numAmount || numAmount < WALLET_FUNDING_CONFIG.min_amount) {
    return res.status(400).json({
      success: false,
      message: `Minimum amount is ₦${WALLET_FUNDING_CONFIG.min_amount.toLocaleString()}`,
    });
  }

  if (numAmount > WALLET_FUNDING_CONFIG.max_amount) {
    return res.status(400).json({
      success: false,
      message: `Maximum amount is ₦${WALLET_FUNDING_CONFIG.max_amount.toLocaleString()}`,
    });
  }

  try {
    const reference = `wallet_fund_${userId}_${Date.now()}`;

    let payerEmail = req.user?.email || req.user?.user_email || null;
    if (!payerEmail) {
      const [emailRows] = await db.query(
        `SELECT user_email FROM users WHERE user_id = ? LIMIT 1`,
        [userId],
      );
      payerEmail = emailRows?.[0]?.user_email || null;
    }

    if (!payerEmail) {
      return res.status(400).json({
        success: false,
        message:
          "Unable to initialize payment: no email found for this account.",
      });
    }

    if (!process.env.PAYSTACK_SECRET_KEY) {
      console.error("PAYSTACK_SECRET_KEY is missing");
      return res.status(500).json({
        success: false,
        message: "Payment gateway is not configured. Please contact support.",
      });
    }

    // Fee config: 1.5% + ₦100, capped at ₦2000
    const fee = calculateWalletFundingFee(numAmount);
    const totalAmount = numAmount + fee; // This is what user actually pays

    console.log("Initializing Paystack payment", {
      userId,
      baseAmount: numAmount,
      fee,
      totalAmount,
      reference,
      email: payerEmail,
    });

    const paystackResponse = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email: payerEmail,
        amount: Math.round(totalAmount * 100), // Paystack sees TOTAL
        currency: "NGN",
        reference,
        callback_url: "https://server.pipiafrica.com/api/wallet/fund/callback",
        metadata: {
          user_id: userId,
          type: "wallet_funding",
          base_amount: numAmount, // So webhook knows how much to credit
          fee: fee,
          total_amount: totalAmount,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      },
    );

    const { authorization_url, reference: paystackRef } =
      paystackResponse.data.data;

    res.json({
      success: true,
      authorization_url,
      reference: paystackRef || reference,
      amount: numAmount, // original amount user wanted
      fee,
      total: totalAmount, // actual charged amount
      config: WALLET_FUNDING_CONFIG,
      message: "Payment initialized successfully",
    });
  } catch (err) {
    console.error("Paystack init error:", {
      message: err.message,
      code: err.code,
      status: err.response?.status,
      data: err.response?.data,
    });
    res.status(500).json({
      success: false,
      message: "Failed to connect to payment gateway. Please try again.",
    });
  }
};
// === PAYSTACK WEBHOOK (MUST BE PUBLIC URL) ===
exports.verifyWalletFunding = async (req, res) => {
  console.log("WEBHOOK HIT:", req.originalUrl); // ← You should see this now

  const signature = req.headers["x-paystack-signature"];
  const hash = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
    .update(req.rawBody || "") // ← This is the key
    .digest("hex");

  if (hash !== signature) {
    console.log("Invalid Paystack signature!", {
      expected: hash,
      received: signature,
    });
    return res.status(401).send("Invalid signature");
  }

  console.log("Valid Paystack webhook received!");

  const event = req.body;

  if (event.event === "charge.success") {
    const metadata = event.data.metadata || {};
    const ref = event.data.reference;

    const userId = metadata.user_id;
    const baseAmount = Number.parseFloat(metadata.base_amount || 0);

    if (!userId || !baseAmount) {
      console.error("Missing metadata", metadata);
      return res.sendStatus(200);
    }

    try {
      const result = await processWalletFundingCredit({
        userId,
        baseAmount,
        ref,
      });

      console.log("✅ Wallet funding webhook processed", {
        userId,
        ref,
        baseAmount,
        credited: result.credited,
        alreadyProcessed: result.alreadyProcessed,
      });
    } catch (err) {
      console.error("DB Error in webhook:", err);
    }
  }

  res.sendStatus(200);
};

exports.testCredit = async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ success: false, msg: "Test route disabled" });
  }

  const { amount } = req.body;
  if (!amount || amount <= 0)
    return res.status(400).json({ success: false, msg: "Invalid amount" });

  const userId = req.user.id;
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // Update balance
    await connection.query(
      `UPDATE users SET user_wallet_balance = user_wallet_balance + ? WHERE user_id = ?`,
      [amount, userId],
    );

    // INSERT — NO reference column → put it in description
    await connection.query(
      `INSERT INTO wallet_transactions 
       (user_id, node_type, node_id, amount, type, date, description)
       VALUES (?, 'recharge', NULL, ?, 'in', NOW(), ?)`,
      [
        userId,
        amount,
        `Wallet funded via Paystack (Test) – Ref: test_ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ],
    );

    await NotificationService.createNotification(
      userId,
      userId,
      "wallet_payment",
      `Your wallet was funded with ₦${Number(amount).toFixed(2)}`,
      "wallet",
      userId,
      "/wallet",
    );

    await connection.commit();
    console.log(`TEST CREDIT SUCCESS: ₦${amount} → user ${userId}`);

    res.json({ success: true, message: "Test credit applied" });
  } catch (err) {
    await connection.rollback();
    console.error("TEST CREDIT ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    connection.release();
  }
};

// controllers/walletController.js
exports.handlePaystackCallback = async (req, res) => {
  const { reference } = req.query;

  if (!reference) {
    return res.redirect("https://pipiafrica.com/wallet?status=failed");
  }

  try {
    // 1. Verify the transaction directly with Paystack
    const verification = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      },
    );

    const data = verification.data.data;

    if (data.status !== "success") {
      return res.redirect("https://pipiafrica.com/wallet?status=failed");
    }

    // 2. Extract metadata (same as before)
    const metadata = data.metadata || {};
    const userId = metadata.user_id;
    const baseAmount = Number.parseFloat(metadata.base_amount || 0);
    const ref = data.reference;

    if (!userId || !baseAmount) {
      return res.redirect("https://pipiafrica.com/wallet?status=failed");
    }

    // 3. Credit once (same logic as webhook; if webhook already processed, this no-ops)
    const result = await processWalletFundingCredit({
      userId,
      baseAmount,
      ref,
    });

    console.log("✅ Wallet funding callback processed", {
      userId,
      ref,
      baseAmount,
      credited: result.credited,
      alreadyProcessed: result.alreadyProcessed,
    });

    // 4. Redirect user to success page
    res.redirect("https://pipiafrica.com/wallet?status=success");
  } catch (err) {
    console.error("Callback verification failed:", err.message);
    res.redirect("https://pipiafrica.com/wallet?status=failed");
  }
};
