// controllers/affiliateController.js
const pool = require("../config/db");

// Helper: Get system settings
const getSystemSetting = async (key) => {
  const [rows] = await pool.query(
    "SELECT option_value FROM system_options WHERE option_name = ?",
    [key],
  );
  return rows[0]?.option_value || null;
};

// 1. Register with referral (?ref=username or ?ref=123)
const registerWithReferral = async (req, res) => {
  const { ref } = req.query;
  const userData = req.body; // Assume you already validated & hashed password

  if (!ref) {
    return res
      .status(400)
      .json({ success: false, message: "No referral code" });
  }

  try {
    // Find referrer by username or user_id
    const [referrers] = await pool.query(
      `SELECT user_id FROM users WHERE user_name = ? OR user_id = ? LIMIT 1`,
      [ref, ref],
    );

    const referrer = referrers[0];
    if (!referrer) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid referral" });
    }

    // Create new user (you should do this in a transaction with password hashing)
    const [result] = await pool.query(
      `INSERT INTO users (
        user_name, user_email, user_password, user_firstname, user_lastname,
        user_gender, user_registered, user_activated
      ) VALUES (?, ?, ?, ?, ?, ?, NOW(), '1')`,
      [
        userData.user_name,
        userData.user_email,
        userData.user_password, // hashed already
        userData.user_firstname || "",
        userData.user_lastname || "",
        userData.user_gender || 0,
      ],
    );

    const newUserId = result.insertId;

    // Set referrer
    await pool.query(
      `UPDATE users SET user_referrer_id = ? WHERE user_id = ?`,
      [referrer.user_id, newUserId],
    );

    // Record referral relationship
    await pool.query(
      `INSERT INTO users_affiliates (referrer_id, referee_id) VALUES (?, ?)`,
      [referrer.user_id, newUserId],
    );

    // Give referral bonus
    await giveReferralBonus(referrer.user_id, newUserId);

    res.json({
      success: true,
      message: "Registered with referral",
      user_id: newUserId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Core: Give bonus on new referral
const giveReferralBonus = async (referrerId, newUserId) => {
  const enabled = await getSystemSetting("affiliates_system_enabled");
  if (enabled !== "1") return;

  const pointsEnabled = await getSystemSetting(
    "affiliates_money_points_enabled",
  );
  const walletEnabled = await getSystemSetting(
    "affiliates_money_wallet_enabled",
  );
  const pointsPerRef = parseInt(
    (await getSystemSetting("affiliates_per_referral_points")) || 0,
  );
  const moneyPerRef = parseFloat(
    (await getSystemSetting("affiliates_per_referral_money")) || 0,
  );

  const [users] = await pool.query(`SELECT * FROM users WHERE user_id = ?`, [
    referrerId,
  ]);
  const referrer = users[0];

  let updated = false;

  // Points Bonus
  if (pointsEnabled === "1" && pointsPerRef > 0) {
    await pool.query(
      `UPDATE users SET user_points = user_points + ? WHERE user_id = ?`,
      [pointsPerRef, referrerId],
    );
    updated = true;
  }

  // Wallet Bonus
  if (walletEnabled === "1" && moneyPerRef > 0) {
    await pool.query(
      `UPDATE users SET 
        user_affiliate_balance = user_affiliate_balance + ?,
        user_wallet_balance = user_wallet_balance + ?
       WHERE user_id = ?`,
      [moneyPerRef, moneyPerRef, referrerId],
    );

    // Log transaction
    await pool.query(
      `INSERT INTO wallet_transactions 
        (user_id, node_type, node_id, amount, type, date) 
       VALUES (?, 'affiliate', ?, ?, 'in', NOW())`,
      [referrerId, newUserId, moneyPerRef],
    );
    updated = true;
  }

  if (updated) {
    console.log(
      `Referral bonus given to user ${referrerId}: +${pointsPerRef} points, +$${moneyPerRef}`,
    );
  }
};

// 2. Get Affiliate Stats
const getAffiliateStats = async (req, res) => {
  const userId = req.user.id; // ← FIXED: req.user.id

  try {
    const [[referralCount]] = await pool.query(
      `SELECT COUNT(*) as count FROM users_affiliates WHERE referrer_id = ?`,
      [userId],
    );

    const [[user]] = await pool.query(
      `SELECT 
         COALESCE(user_affiliate_balance, 0) as user_affiliate_balance,
         COALESCE(user_points, 0) as user_points 
       FROM users WHERE user_id = ?`,
      [userId],
    );

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const [[pending]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM affiliates_payments 
       WHERE user_id = ? AND status = 0`,
      [userId],
    );

    const [[paid]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM affiliates_payments 
       WHERE user_id = ? AND status = 1`,
      [userId],
    );
    const [[bonusRow]] = await pool.query(
      "SELECT option_value FROM system_options WHERE option_name = 'affiliates_per_user'",
    );

    const bonusAmount = bonusRow?.option_value || "5000";

    res.json({
      success: true,
      data: {
        total_referrals: referralCount.count || 0,
        affiliate_balance: parseFloat(user.user_affiliate_balance || 0),
        total_earned: parseFloat(paid.total || 0),
        pending_withdrawal: parseFloat(pending.total || 0),
        points: parseFloat(user.user_points || 0),
        affiliates_per_user: bonusAmount, // ← THIS IS WHAT MOBILE READS
      },
    });
  } catch (err) {
    console.error("getAffiliateStats error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 3. Request Affiliate Payout — FINAL VERSION (Wallet = Instant!)
const requestPayout = async (req, res) => {
  const userId = req.user.id;
  const { amount, method, paypal_email, bank_details } = req.body;

  if (!amount || !method) {
    return res
      .status(400)
      .json({ success: false, message: "Amount and method required" });
  }

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount < 50) {
    return res
      .status(400)
      .json({ success: false, message: "Minimum withdrawal is ₦50" });
  }

  try {
    await pool.query("START TRANSACTION");

    // Lock user row to prevent race condition
    const [[user]] = await pool.query(
      `SELECT 
         COALESCE(user_affiliate_balance, 0) as affiliate_balance,
         COALESCE(user_wallet_balance, 0) as wallet_balance
       FROM users WHERE user_id = ? FOR UPDATE`,
      [userId],
    );

    if (!user || user.affiliate_balance < numAmount) {
      await pool.query("ROLLBACK");
      return res
        .status(400)
        .json({ success: false, message: "Insufficient affiliate balance" });
    }

    // CASE 1: Instant Wallet Transfer
    if (method === "wallet") {
      // Transfer instantly: affiliate_balance → wallet_balance
      await pool.query(
        `UPDATE users 
         SET user_affiliate_balance = user_affiliate_balance - ?,
             user_wallet_balance = user_wallet_balance + ?
         WHERE user_id = ?`,
        [numAmount, numAmount, userId],
      );

      // Log as completed instantly
      await pool.query(
        `INSERT INTO affiliates_payments 
          (user_id, amount, method, method_value, time, status) 
         VALUES (?, ?, ?, 0, NOW(), 1)`, // status = 1 → Completed
        [userId, numAmount, "wallet"],
      );

      // Also log in wallet_transactions
      await pool.query(
        `INSERT INTO wallet_transactions 
            (user_id, node_type, node_id, amount, type, date, description) 
        VALUES (?, 'affiliate_withdrawal', NULL, ?, 'in', NOW(), 'Affiliate earnings → Wallet')`,
        [userId, numAmount.toString()], // ← convert number → string (safe for varchar)
      );

      await pool.query("COMMIT");

      return res.json({
        success: true,
        message: `₦${numAmount.toLocaleString()} transferred to your wallet instantly!`,
      });
    }

    // CASE 2: PayPal or Skrill → Pending (Manual)
    else {
      // Deduct from affiliate balance
      await pool.query(
        `UPDATE users SET user_affiliate_balance = user_affiliate_balance - ? WHERE user_id = ?`,
        [numAmount, userId],
      );

      let methodValue = null;
      if (method === "paypal" && paypal_email) {
        methodValue = JSON.stringify({ recipient: paypal_email });
      } else if (method === "skrill" && bank_details) {
        methodValue = JSON.stringify(bank_details);
      }

      await pool.query(
        `INSERT INTO affiliates_payments 
          (user_id, amount, method, method_value, time, status) 
         VALUES (?, ?, ?, ?, NOW(), 0)`, // status = 0 → Pending
        [userId, numAmount, method, methodValue],
      );

      await pool.query("COMMIT");

      return res.json({
        success: true,
        message: "Withdrawal request submitted! Awaiting admin approval.",
      });
    }
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("requestPayout error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 4. Get Referral Link — FIXED
const getReferralLink = async (req, res) => {
  const userId = req.user.id; // ← FIXED
  const baseUrl = process.env.APP_URL || "https://pipiafrica.com";

  try {
    const [[user]] = await pool.query(
      `SELECT user_name FROM users WHERE user_id = ?`,
      [userId],
    );

    if (!user || !user.user_name) {
      return res
        .status(400)
        .json({ success: false, message: "Username not found" });
    }

    const username = user.user_name;

    res.json({
      success: true,
      referral_link: `${baseUrl}/signup?ref=${username}`,
      short_link: `${baseUrl}/?ref=${username}`,
    });
  } catch (err) {
    console.error("getReferralLink error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
// In your auth or user routes
const referralLink = async (req, res) => {
  const [user] = await pool.query(
    "SELECT user_name FROM users WHERE user_id = ?",
    [req.user.id],
  );
  const link = `${process.env.APP_BASE_URL}/signup?ref=${user[0].username}`;
  res.json({ success: true, referral_link: link });
};

const withdrawals = async (req, res) => {
  try {
    // Safety first — if req.user missing, reject early
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const [rows] = await pool.query(
      `SELECT payment_id, user_id, amount, method, method_value, time, status 
       FROM affiliates_payments 
       WHERE user_id = ? 
       ORDER BY time DESC`,
      [req.user.id],
    );

    // Always return valid JSON, even if empty
    return res.json({
      success: true,
      data: rows || [],
    });
  } catch (err) {
    console.error("Withdrawals history error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load withdrawal history",
    });
  }
};

// Add this new function in your affiliateController.js
const withdrawPointsToWallet = async (req, res) => {
  const userId = req.user.id;
  const { amount } = req.body;

  const numAmount = parseFloat(amount);
  if (!amount || isNaN(numAmount) || numAmount < 100) {
    return res.status(400).json({ success: false, message: "Minimum ₦100" });
  }
  if (numAmount > 100000) {
    return res
      .status(400)
      .json({ success: false, message: "Maximum ₦100,000 per withdrawal" });
  }

  try {
    await pool.query("START TRANSACTION");

    const [[user]] = await pool.query(
      `SELECT COALESCE(user_points, 0) as points,
              COALESCE(user_wallet_balance, 0) as wallet_balance
       FROM users WHERE user_id = ? FOR UPDATE`,
      [userId],
    );

    if (!user || user.points < numAmount) {
      await pool.query("ROLLBACK");
      return res
        .status(400)
        .json({ success: false, message: "Insufficient points" });
    }

    // Deduct points, add to wallet
    await pool.query(
      `UPDATE users 
       SET user_points = user_points - ?,
           user_wallet_balance = user_wallet_balance + ?
       WHERE user_id = ?`,
      [numAmount, numAmount, userId],
    );

    // Optional: Log in a new table or reuse wallet_transactions
    await pool.query(
      `INSERT INTO wallet_transactions 
         (user_id, node_type, node_id, amount, type, date, description)
       VALUES (?, 'points_conversion', NULL, ?, 'in', NOW(), 'Points converted to wallet balance')`,
      [userId, numAmount.toString()],
    );

    await pool.query("COMMIT");

    res.json({
      success: true,
      message: `₦${numAmount.toLocaleString()} added to your wallet from points!`,
    });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("withdrawPointsToWallet error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  registerWithReferral,
  getAffiliateStats,
  requestPayout,
  getReferralLink,
  giveReferralBonus,
  referralLink,
  withdrawals,
  withdrawPointsToWallet,
};
