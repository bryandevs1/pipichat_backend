const db = require("../config/db");

// Add a new transaction to the wallet
const addTransaction = (user_id, node_type, node_id, amount, type) => {
  return new Promise((resolve, reject) => {
    const query = `
      INSERT INTO wallet_transactions (user_id, node_type, node_id, amount, type, date)
      VALUES (?, ?, ?, ?, ?, NOW())`;
    db.query(
      query,
      [user_id, node_type, node_id, amount, type],
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );
  });
};

// Update the user's wallet balance
const updateWalletBalance = (user_id, amount) => {
  return new Promise((resolve, reject) => {
    const query = `UPDATE users SET user_wallet_balance = user_wallet_balance + ? WHERE user_id = ?`;
    db.query(query, [amount, user_id], (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
};

// Get all user transactions
const getUserTransactions = (user_id) => {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY date DESC`;
    db.query(query, [user_id], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

const WalletModels = {
  // Use arrow functions to ensure `this` is correctly bound
  deductFromWallet: async (user_id, amount) => {
    return WalletModels.updateBalance(user_id, -amount); // Use helper function
  },

  addToWallet: async (user_id, amount) => {
    return WalletModels.updateBalance(user_id, amount); // Use helper function
  },

  updateBalance: async (user_id, amount) => {
    // Helper for both deduct and add
    const query = `UPDATE users SET user_wallet_balance = user_wallet_balance + ? WHERE user_id = ?`;
    try {
      const [result] = await db.execute(query, [amount, user_id]);
      return result.affectedRows; // Return the number of affected rows
    } catch (err) {
      throw err; // Re-throw for handling by the caller
    }
  },

  recordTransaction: async ({ user_id, node_type, node_id, amount, type }) => {
    const query = `
      INSERT INTO wallet_transactions (user_id, node_type, node_id, amount, type, date)
      VALUES (?, ?, ?, ?, ?, NOW())`;
    try {
      const [result] = await db.execute(query, [
        user_id,
        node_type,
        node_id,
        amount,
        type,
      ]);
      return result.affectedRows; // Return the number of affected rows
    } catch (err) {
      throw err; // Re-throw for handling by the caller
    }
  },

  getWalletBalance: async (user_id) => {
    const query = `SELECT user_wallet_balance FROM users WHERE user_id = ?`;
    try {
      const [rows] = await db.execute(query, [user_id]);
      return rows[0]?.user_wallet_balance || 0;
    } catch (err) {
      throw err; // Re-throw for handling by the caller
    }
  },
  getAffiliateBalance: async (user_id) => {
    const query = `SELECT user_affiliate_balance FROM users WHERE user_id = ?`;
    try {
      const [rows] = await db.execute(query, [user_id]);
      return rows[0]?.user_affiliate_balance || 0;
    } catch (err) {
      throw err; // Re-throw for handling by the caller
    }
  },

  // Transaction wrapper (CRITICAL)
  transfer: async (fromUserId, toUserId, amount, transactionDetails) => {
    try {
      await db.beginTransaction(); // Start the transaction

      const deductionResult = await WalletModels.deductFromWallet(
        fromUserId,
        amount
      );
      if (!deductionResult) {
        throw new Error("Deduction failed"); // Or a custom error
      }

      const additionResult = await WalletModels.addToWallet(toUserId, amount);
      if (!additionResult) {
        throw new Error("Addition failed"); // Or a custom error
      }

      const recordResult = await WalletModels.recordTransaction(
        transactionDetails
      );
      if (!recordResult) {
        throw new Error("Transaction record failed");
      }

      await db.commit(); // Commit if all operations succeed
      return { status: "success", message: "Transfer successful" };
    } catch (err) {
      await db.rollback(); // Rollback if any operation fails
      return { status: "failed", message: err.message };
    }
  },
  async getAffiliateBalance(userId) {
    console.log(`Fetching affiliate balance for user: ${userId}`);
    const [rows] = await db.query(
      "SELECT user_affiliate_balance FROM users WHERE user_id = ?",
      [userId]
    );
    const balance = rows[0]?.user_affiliate_balance || 0;
    console.log(`Affiliate balance for user ${userId}: ${balance}`);
    return balance;
  },

  // Deduct affiliate points
  async deductAffiliatePoints(userId, points) {
    console.log(`Deducting ${points} affiliate points from user: ${userId}`);
    await db.query(
      "UPDATE users SET user_affiliate_balance = user_affiliate_balance - ? WHERE user_id = ?",
      [points, userId]
    );
    console.log(`Deducted ${points} points from user ${userId}`);
  },

  // Add to wallet balance
  async addToWalletBalance(userId, amount) {
    console.log(`Adding ${amount} to wallet balance of user: ${userId}`);
    await db.query(
      "UPDATE users SET user_wallet_balance = user_wallet_balance + ? WHERE user_id = ?",
      [amount, userId]
    );
    console.log(`Added ${amount} to wallet balance of user ${userId}`);
  },

  // Log wallet transaction
  async logWalletTransaction({ userId, amount, transactionType }) {
    console.log(
      `Logging transaction: User ${userId}, Amount: ${amount}, Type: ${transactionType}`
    );
    await db.query(
      `INSERT INTO wallet_transactions (user_id, amount, node_type, date)
       VALUES (?, ?, ?, NOW())`,
      [userId, amount, transactionType]
    );
    console.log(
      `Transaction logged: User ${userId}, Amount: ${amount}, Type: ${transactionType}`
    );
  },

  // Database transaction methods
  async beginTransaction() {
    console.log("Starting database transaction...");
    await db.query("START TRANSACTION");
  },

  async commitTransaction() {
    console.log("Committing database transaction...");
    await db.query("COMMIT");
    console.log("Transaction committed.");
  },

  async rollbackTransaction() {
    console.log("Rolling back database transaction...");
    await db.query("ROLLBACK");
    console.log("Transaction rolled back.");
  },
};

const PointModels = {
  getPointsBalance: async (user_id) => {
    const query = `SELECT user_points FROM users WHERE user_id = ?`;
    try {
      const [rows] = await db.execute(query, [user_id]);
      return rows[0]?.user_points || 0;
    } catch (err) {
      throw err; // Re-throw for handling by the caller
    }
  },

  // Transaction wrapper (CRITICAL)
  transferPoints: async (fromUserId, toUserId, amount, transactionDetails) => {
    try {
      await db.beginTransaction(); // Start the transaction

      const deductionResult = await WalletModels.deductFromWallet(
        fromUserId,
        amount
      );
      if (!deductionResult) {
        throw new Error("Deduction failed"); // Or a custom error
      }

      const additionResult = await WalletModels.addToWallet(toUserId, amount);
      if (!additionResult) {
        throw new Error("Addition failed"); // Or a custom error
      }

      const recordResult = await WalletModels.recordTransaction(
        transactionDetails
      );
      if (!recordResult) {
        throw new Error("Transaction record failed");
      }

      await db.commit(); // Commit if all operations succeed
      return { status: "success", message: "Transfer successful" };
    } catch (err) {
      await db.rollback(); // Rollback if any operation fails
      return { status: "failed", message: err.message };
    }
  },
  async getPointsBalance(userId) {
    console.log(`Fetching affiliate balance for user: ${userId}`);
    const [rows] = await db.query(
      "SELECT user_points FROM users WHERE user_id = ?",
      [userId]
    );
    const balance = rows[0]?.user_points || 0;
    console.log(`Points for user ${userId}: ${balance}`);
    return balance;
  },

  // Deduct affiliate points
  async deductPoints(userId, points) {
    console.log(`Deducting ${points} affiliate points from user: ${userId}`);
    await db.query(
      "UPDATE users SET user_points = user_points - ? WHERE user_id = ?",
      [points, userId]
    );
    console.log(`Deducted ${points} points from user ${userId}`);
  },

  // Add to wallet balance
  async addPointsToWalletBalance(userId, amount) {
    console.log(`Adding ${amount} to wallet balance of user: ${userId}`);
    await db.query(
      "UPDATE users SET user_wallet_balance = user_wallet_balance + ? WHERE user_id = ?",
      [amount, userId]
    );
    console.log(`Added ${amount} to wallet balance of user ${userId}`);
  },

  // Log wallet transaction
  async logWalletPointsTransaction({ userId, amount, transactionType }) {
    console.log(
      `Logging transaction: User ${userId}, Amount: ${amount}, Type: ${transactionType}`
    );
    await db.query(
      `INSERT INTO wallet_transactions (user_id, amount, node_type, date)
       VALUES (?, ?, ?, NOW())`,
      [userId, amount, transactionType]
    );
    console.log(
      `Transaction logged: User ${userId}, Amount: ${amount}, Type: ${transactionType}`
    );
  },

  // Database transaction methods
  async beginPointsTransaction() {
    console.log("Starting database transaction...");
    await db.query("START TRANSACTION");
  },

  async commitPointsTransaction() {
    console.log("Committing database transaction...");
    await db.query("COMMIT");
    console.log("Transaction committed.");
  },

  async rollbackPointsTransaction() {
    console.log("Rolling back database transaction...");
    await db.query("ROLLBACK");
    console.log("Transaction rolled back.");
  },
};
const FundingModels = {
  getFundingBalance: async (user_id) => {
    const query = `SELECT user_funding_balance FROM users WHERE user_id = ?`;
    try {
      const [rows] = await db.execute(query, [user_id]);
      return rows[0]?.user_funding_balance || 0;
    } catch (err) {
      throw err; // Re-throw for handling by the caller
    }
  },

  // Transaction wrapper (CRITICAL)
  transferFunding: async (fromUserId, toUserId, amount, transactionDetails) => {
    try {
      await db.beginTransaction(); // Start the transaction

      const deductionResult = await WalletModels.deductFromWallet(
        fromUserId,
        amount
      );
      if (!deductionResult) {
        throw new Error("Deduction failed"); // Or a custom error
      }

      const additionResult = await WalletModels.addToWallet(toUserId, amount);
      if (!additionResult) {
        throw new Error("Addition failed"); // Or a custom error
      }

      const recordResult = await WalletModels.recordTransaction(
        transactionDetails
      );
      if (!recordResult) {
        throw new Error("Transaction record failed");
      }

      await db.commit(); // Commit if all operations succeed
      return { status: "success", message: "Transfer successful" };
    } catch (err) {
      await db.rollback(); // Rollback if any operation fails
      return { status: "failed", message: err.message };
    }
  },
  async getFundingBalance(userId) {
    console.log(`Fetching affiliate balance for user: ${userId}`);
    const [rows] = await db.query(
      "SELECT user_funding_balance FROM users WHERE user_id = ?",
      [userId]
    );
    const balance = rows[0]?.user_funding_balance || 0;
    console.log(`Points for user ${userId}: ${balance}`);
    return balance;
  },

  // Deduct affiliate points
  async deductFunding(userId, points) {
    console.log(`Deducting ${points} affiliate points from user: ${userId}`);
    await db.query(
      "UPDATE users SET user_funding_balance = user_funding_balance - ? WHERE user_id = ?",
      [points, userId]
    );
    console.log(`Deducted ${points} points from user ${userId}`);
  },

  // Add to wallet balance
  async addFundingToWalletBalance(userId, amount) {
    console.log(`Adding ${amount} to wallet balance of user: ${userId}`);
    await db.query(
      "UPDATE users SET user_wallet_balance = user_wallet_balance + ? WHERE user_id = ?",
      [amount, userId]
    );
    console.log(`Added ${amount} to wallet balance of user ${userId}`);
  },

  // Log wallet transaction
  async logWalletFundingTransaction({ userId, amount, transactionType }) {
    console.log(
      `Logging transaction: User ${userId}, Amount: ${amount}, Type: ${transactionType}`
    );
    await db.query(
      `INSERT INTO wallet_transactions (user_id, amount, node_type, date)
       VALUES (?, ?, ?, NOW())`,
      [userId, amount, transactionType]
    );
    console.log(
      `Transaction logged: User ${userId}, Amount: ${amount}, Type: ${transactionType}`
    );
  },

  // Database transaction methods
  async beginFundingTransaction() {
    console.log("Starting database transaction...");
    await db.query("START TRANSACTION");
  },

  async commitFundingTransaction() {
    console.log("Committing database transaction...");
    await db.query("COMMIT");
    console.log("Transaction committed.");
  },

  async rollbackFundingTransaction() {
    console.log("Rolling back database transaction...");
    await db.query("ROLLBACK");
    console.log("Transaction rolled back.");
  },
};

module.exports = {
  addTransaction,
  updateWalletBalance,
  getUserTransactions,
  deductFromWallet: WalletModels.deductFromWallet, // Explicitly export each one
  addToWallet: WalletModels.addToWallet,
  updateWalletBalance: WalletModels.updateBalance,
  recordTransaction: WalletModels.recordTransaction,
  getWalletBalance: WalletModels.getWalletBalance,
  getAffiliateBalance: WalletModels.getAffiliateBalance,
  transfer: WalletModels.transfer,
  deductAffiliatePoints: WalletModels.deductAffiliatePoints,
  addToWalletBalance: WalletModels.addToWalletBalance,
  logWalletTransaction: WalletModels.logWalletTransaction,
  beginTransaction: WalletModels.beginTransaction,
  commitTransaction: WalletModels.commitTransaction,
  rollbackTransaction: WalletModels.rollbackTransaction,
  transferPoints: PointModels.transferPoints,
  getPointsBalance: PointModels.getPointsBalance,
  deductPoints: PointModels.deductPoints,
  addPointsToWalletBalance: PointModels.addPointsToWalletBalance,
  logWalletPointsTransaction: PointModels.logWalletPointsTransaction,
  beginPointsTransaction: PointModels.beginPointsTransaction,
  commitPointsTransaction: PointModels.commitPointsTransaction,
  rollbackPointsTransaction: PointModels.rollbackPointsTransaction,
  transferFunding: FundingModels.transferFunding,
  getFundingBalance: FundingModels.getFundingBalance,
  deductFunding: FundingModels.deductFunding,
  addFundingToWalletBalance: FundingModels.addFundingToWalletBalance,
  logWalletFundingTransaction: FundingModels.logWalletFundingTransaction,
  beginFundingTransaction: FundingModels.beginFundingTransaction,
  commitFundingTransaction: FundingModels.commitFundingTransaction,
  rollbackFundingTransaction: FundingModels.rollbackFundingTransaction,

};
