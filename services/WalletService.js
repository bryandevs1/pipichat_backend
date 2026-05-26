// services/WalletService.js
const db = require("../config/db");

const BALANCE_FIELDS = {
  main: "user_wallet_balance",
  affiliate: "user_affiliate_balance",
  points: "user_points",
  funding: "user_funding_balance",
};

class WalletService {
  static async getBalance(userId, type = "main") {
    const field = BALANCE_FIELDS[type];
    const [rows] = await db.query(
      `SELECT ${field} as balance FROM users WHERE user_id = ?`,
      [userId]
    );
    return parseFloat(rows[0]?.balance || 0);
  }

  static async adjustBalance(userId, amount, type = "main") {
    const field = BALANCE_FIELDS[type];
    const sign = amount >= 0 ? "+" : "-";
    const abs = Math.abs(amount);

    await db.query(
      `UPDATE users SET ${field} = ${field} ${sign} ? WHERE user_id = ?`,
      [abs, userId]
    );
  }

  static async creditWallet(userId, amount, description = "Fund wallet") {
    await db.query("START TRANSACTION");
    try {
      await this.adjustBalance(userId, amount, "main");

      await db.query(
        `INSERT INTO wallet_transactions 
         (user_id, amount, node_type, type, description, date) 
         VALUES (?, ?, 'system', 'in', ?, NOW())`,
        [userId, amount, description]
      );

      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }
  }

  static async convertToWallet(userId, amount, sourceType) {
    if (!["affiliate", "points", "funding"].includes(sourceType)) {
      throw new Error("Invalid source type");
    }

    const currentBalance = await this.getBalance(userId, sourceType);
    if (currentBalance < amount) {
      throw new Error(`Insufficient ${sourceType} balance`);
    }

    await db.query("START TRANSACTION");
    try {
      await this.adjustBalance(userId, -amount, sourceType);
      await this.adjustBalance(userId, amount, "main");

      await db.query(
        `INSERT INTO wallet_transactions 
         (user_id, amount, node_type, type, description, date) 
         VALUES (?, ?, ?, 'in', ?, NOW())`,
        [userId, amount, `convert_${sourceType}`, `Converted ${sourceType} → wallet`]
      );

      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }
  }

  static async transfer(userId, recipientId, amount) {
    if (amount <= 0) throw new Error("Amount must be positive");

    const senderBalance = await this.getBalance(userId, "main");
    if (senderBalance < amount) throw new Error("Insufficient balance");

    await db.query("START TRANSACTION");
    try {
      await this.adjustBalance(userId, -amount, "main");
      await this.adjustBalance(recipientId, amount, "main");

      // Record for sender
      await db.query(
        `INSERT INTO wallet_transactions 
         (user_id, node_id, node_type, amount, type, description, date) 
         VALUES (?, ?, 'user', ?, 'out', 'Sent to user', NOW())`,
        [userId, recipientId, amount]
      );

      // Record for receiver
      await db.query(
        `INSERT INTO wallet_transactions 
         (user_id, node_id, node_type, amount, type, description, date) 
         VALUES (?, ?, 'user', ?, 'in', 'Received from user', NOW())`,
        [recipientId, userId, amount]
      );

      await db.query("COMMIT");
      return true;
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }
  }

static async getTransactions(userId, limit = 50) {
  const [rows] = await db.query(
    `SELECT 
       t.*,

       -- Counterparty info (only for real P2P transfers)
       u.user_name AS counterparty_name,
       u.user_picture AS counterparty_picture,

       -- DIRECTION — super tolerant
       CASE 
         WHEN t.node_type = 'user' AND t.node_id = ? THEN 'in'
         WHEN t.node_type = 'user' AND t.user_id = ? THEN 'out'
         WHEN t.type = 'in' THEN 'in'
         WHEN t.node_type IN (
           'withdraw_points', 'withdraw_affiliate', 'affiliate_withdrawal',
           'recharge', 'package_payment', 'paid_chat_message', 
           'subscribe_profile', 'monetization_transfer'
         ) THEN 'in'
         ELSE 'out'
       END AS direction,

       -- TITLE — smart mapping without changing your DB
       CASE
         WHEN t.node_type = 'user' AND t.node_id = ? THEN 'Received Money'
         WHEN t.node_type = 'user' THEN 'Sent Money'
         WHEN t.node_type = 'withdraw_points' THEN 'Points → Wallet'
         WHEN t.node_type IN ('withdraw_affiliate', 'affiliate_withdrawal') THEN 'Affiliate → Wallet'
         WHEN t.node_type = 'recharge' THEN 'Wallet Top-up'
         WHEN t.node_type = 'monetization_transfer' THEN 'Content Earnings'
         WHEN t.node_type IN ('package_payment', 'paid_chat_message', 'subscribe_profile') THEN 'Service Payment'
         ELSE 'Transaction'
       END AS title,

       -- SUBTITLE — use description if exists, else fallback
       COALESCE(t.description, 
         CASE
           WHEN t.node_type = 'withdraw_points' THEN 'Converted points to wallet'
           WHEN t.node_type IN ('withdraw_affiliate', 'affiliate_withdrawal') THEN 'Affiliate earnings withdrawn'
           WHEN t.node_type = 'recharge' THEN 'Funded via payment'
           WHEN t.node_type = 'monetization_transfer' THEN 'Earnings from your content'
           ELSE NULL
         END
       ) AS subtitle

     FROM wallet_transactions t
     LEFT JOIN users u ON (
       t.node_type = 'user' AND (
         (t.node_id = ? AND u.user_id = t.user_id) OR   -- received from
         (t.user_id = ? AND u.user_id = t.node_id)      -- sent to
       )
     )
     -- FIX: Only show transactions where this user is the primary actor (user_id)
     WHERE t.user_id = ?
     ORDER BY t.date DESC
     LIMIT ?`,
    [userId, userId, userId, userId, userId, userId, limit]
  );

  return rows;
}
}

module.exports = WalletService;