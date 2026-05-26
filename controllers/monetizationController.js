const pool = require('../config/db');

const COMMISSION_RATE = 0.10; // 10%

exports.getSettings = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
        user_monetization_enabled,
        user_monetization_chat_price,
        user_monetization_call_price,
        user_monetization_min_price,
        user_monetization_balance,
        user_wallet_balance,
        user_verified  -- ADD THIS
      FROM users 
      WHERE user_id = ?`,
      [req.user.id]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = rows[0];

    res.json({
      success: true,
      data: {
        verified: user.user_verified === '1',  // THIS IS THE KEY
        enabled: user.user_monetization_enabled === '1',
        chat_price: parseFloat(user.user_monetization_chat_price || 0),
        call_price: parseFloat(user.user_monetization_call_price || 0),
        min_price: parseFloat(user.user_monetization_min_price || 0),
        balance: parseFloat(user.user_monetization_balance || 0),
        wallet_balance: parseFloat(user.user_wallet_balance || 0)
      }
    });
  } catch (err) {
    console.error("getSettings error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.updateSettings = async (req, res) => {
  const { enabled, chat_price, call_price } = req.body;
  const userId = req.user.id;

  await pool.query(
    `UPDATE users SET 
      user_monetization_enabled = ?, 
      user_monetization_chat_price = ?, 
      user_monetization_call_price = ?
      WHERE user_id = ?`,
    [enabled ? 1 : 0, chat_price || 0, call_price || 0, userId]
  );

  res.json({ success: true, message: "Settings updated" });
};

exports.getPlans = async (req, res) => {
  const [plans] = await pool.query(
    "SELECT * FROM monetization_plans WHERE node_id = ? AND node_type = 'user' ORDER BY plan_order",
    [req.user.id]
  );
  res.json({ success: true, data: plans });
};

exports.createPlan = async (req, res) => {
  const { title, price, period_num, period, custom_description, plan_order } = req.body;
  const userId = req.user.id;

  try {
    // Step 1: Get next order number
    const [[max]] = await pool.query(
      "SELECT COALESCE(MAX(plan_order), 0) + 1 AS next_order FROM monetization_plans WHERE node_id = ?",
      [userId]
    );

    const nextOrder = plan_order ? parseInt(plan_order) : (max.next_order || 1);

    // Step 2: Insert the plan
    await pool.query(
      `INSERT INTO monetization_plans 
        (node_id, node_type, title, price, period_num, period, custom_description, plan_order) 
       VALUES (?, 'user', ?, ?, ?, ?, ?, ?)`,
      [userId, title, price, period_num || 1, period || 'month', custom_description || null, nextOrder]
    );

    res.json({ success: true, message: "Plan created" });
  } catch (err) {
    console.error("createPlan error:", err);
    res.status(500).json({ success: false, message: "Failed to create plan" });
  }
};

exports.updatePlan = async (req, res) => {
  const { id } = req.params;
  const { title, price, period_num, period } = req.body;

  await pool.query(
    "UPDATE monetization_plans SET title = ?, price = ?, period_num = ?, period = ? WHERE plan_id = ? AND node_id = ?",
    [title, price, period_num, period, id, req.user.id]
  );

  res.json({ success: true, message: "Plan updated" });
};

exports.deletePlan = async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM monetization_plans WHERE plan_id = ? AND node_id = ?", [id, req.user.id]);
  res.json({ success: true, message: "Plan deleted" });
};

exports.subscribe = async (req, res) => {
  const { creator_id, plan_id } = req.body;
  const userId = req.user.id;

  const [[plan]] = await pool.query("SELECT * FROM monetization_plans WHERE plan_id = ? AND node_id = ?", [plan_id, creator_id]);
  if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });

  const amount = parseFloat(plan.price);
  const commission = amount * COMMISSION_RATE;
  const creatorGets = amount - commission;

  // Deduct from subscriber wallet
  const [[subscriber]] = await pool.query("SELECT user_wallet_balance FROM users WHERE user_id = ?", [userId]);
  if (parseFloat(subscriber.user_wallet_balance) < amount) {
    return res.status(400).json({ success: false, message: " insufficient wallet balance" });
  }

  await pool.query("UPDATE users SET user_wallet_balance = user_wallet_balance - ? WHERE user_id = ?", [amount, userId]);
  await pool.query("UPDATE users SET user_monetization_balance = user_monetization_balance + ? WHERE user_id = ?", [creatorGets, creator_id]);

  // Log payment
  await pool.query(
    "INSERT INTO monetization_payments (user_id, amount, method, time, status) VALUES (?, ?, 'wallet', NOW(), 1)",
    [userId, amount]
  );

  // Create subscription
  await pool.query(
    `INSERT INTO subscribers (user_id, node_id, node_type, plan_id, time) 
     VALUES (?, ?, 'user', ?, NOW())
     ON DUPLICATE KEY UPDATE plan_id = ?, time = NOW()`,
    [userId, creator_id, plan_id, plan_id]
  );

  res.json({ success: true, message: "Subscribed successfully!" });
};

exports.unsubscribe = async (req, res) => {
  const { creator_id } = req.body;
  await pool.query("DELETE FROM subscribers WHERE user_id = ? AND node_id = ?", [req.user.id, creator_id]);
  res.json({ success: true, message: "Unsubscribed" });
};

exports.getSubscribers = async (req, res) => {
  const [subs] = await pool.query(
    `SELECT s.*, u.user_name, u.user_firstname, u.user_picture, p.title as plan_title, p.price 
     FROM subscribers s 
     JOIN users u ON s.user_id = u.user_id 
     LEFT JOIN monetization_plans p ON s.plan_id = p.plan_id 
     WHERE s.node_id = ? AND s.node_type = 'user'`,
    [req.user.id]
  );
  res.json({ success: true, count: subs.length, data: subs });
};

// controllers/monetizationController.js
exports.getBalance = async (req, res) => {
    try {
      console.log("getBalance called for user_id:", req.user.id);
    const [rows] = await pool.query(
      "SELECT user_monetization_balance, user_wallet_balance FROM users WHERE user_id = ?",
      [req.user.id]
    );

    // ADD THIS SAFETY CHECK
    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const user = rows[0];

    res.json({
      success: true,
      data: {
        monetization_balance: parseFloat(user.user_monetization_balance || 0),
        wallet_balance: parseFloat(user.user_wallet_balance || 0)
      }
    });
  } catch (err) {
    console.error("getBalance error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.requestWithdrawal = async (req, res) => {
  const { amount, type, recipient } = req.body;
  // type: 'wallet' | 'paypal' | 'skrill'
  const userId = req.user.id;
  const amountFloat = parseFloat(amount);

  if (isNaN(amountFloat) || amountFloat < 50) {
    return res.status(400).json({
      success: false,
      message: "Minimum withdrawal is ₦50"
    });
  }

  try {
    // Check balance
    const [[user]] = await pool.query(
      "SELECT user_monetization_balance FROM users WHERE user_id = ?",
      [userId]
    );

    if (!user || parseFloat(user.user_monetization_balance) < amountFloat) {
      return res.status(400).json({
        success: false,
        message: "Insufficient balance"
      });
    }

    // Deduct from monetization balance (always)
    await pool.query(
      "UPDATE users SET user_monetization_balance = user_monetization_balance - ? WHERE user_id = ?",
      [amountFloat, userId]
    );

    if (type === "wallet") {
      // Instant transfer to main wallet
      await pool.query(
        "UPDATE users SET user_wallet_balance = user_wallet_balance + ? WHERE user_id = ?",
        [amountFloat, userId]
      );

      await pool.query(
        "INSERT INTO wallet_transactions (user_id, amount, type, node_type, date) VALUES (?, ?, 'in', 'monetization_transfer', NOW())",
        [userId, amountFloat]
      );

      return res.json({
        success: true,
        message: "Successfully transferred to your wallet!"
      });
    }

    // External withdrawals: PayPal or Skrill
    if (type === "paypal" || type === "skrill") {
      if (!recipient || !recipient.trim()) {
        return res.status(400).json({
          success: false,
          message: `${type.toUpperCase()} email/ID is required`
        });
      }

      const methodName = type === "paypal" ? "paypal" : "skrill";

      await pool.query(
        `INSERT INTO monetization_payments 
         (user_id, amount, method, method_value, time, status) 
         VALUES (?, ?, ?, ?, NOW(), 0)`,
        [
          userId,
          amountFloat,
          methodName,
          JSON.stringify({ recipient: recipient.trim(), type: methodName })
        ]
      );

      return res.json({
        success: true,
        message: `Withdrawal request sent!\nAdmin will send ₦${amountFloat.toLocaleString()} to your ${type.toUpperCase()}:\n${recipient.trim()} within 24-48 hours.`
      });
    }

    // Fallback
    return res.status(400).json({
      success: false,
      message: "Invalid withdrawal type"
    });

  } catch (err) {
    console.error("Withdrawal error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getWithdrawals = async (req, res) => {
  const [history] = await pool.query(
    "SELECT * FROM monetization_payments WHERE user_id = ? ORDER BY time DESC",
    [req.user.id]
  );
  res.json({ success: true, data: history });
};