/**
 * Points/Coins Helper Service
 * Handles adding points, checking daily limits, and transactions
 */

const db = require("../config/db");
const POINTS_CONFIG = require("../utils/pointsConfig");

class PointsService {
  /**
   * Check if user is a pro/paid user (has active subscription)
   */
  static async isProUser(userId) {
    try {
      const [rows] = await db.query(
        `SELECT 1 FROM packages_payments pp
         WHERE pp.user_id = ? AND pp.payment_date <= NOW()
         ORDER BY pp.payment_date DESC
         LIMIT 1`,
        [userId],
      );
      return rows.length > 0;
    } catch (error) {
      console.error("❌ Error checking pro user status:", error);
      return false;
    }
  }

  /**
   * Get daily points earned by user (today)
   */
  static async getDailyPointsEarned(userId) {
    try {
      const [rows] = await db.query(
        `SELECT COALESCE(SUM(points_earned), 0) as total
         FROM users_points_transactions
         WHERE user_id = ? AND DATE(transaction_date) = DATE(NOW())
         AND transaction_type IN ('post_view', 'post_created', 'comment_created', 'reaction', 'follower', 'referral')`,
        [userId],
      );
      return Number(rows[0]?.total || 0);
    } catch (error) {
      console.error("❌ Error getting daily points:", error);
      return 0;
    }
  }

  /**
   * Check if user can earn more points today
   */
  static async canEarnMorePointsToday(userId, pointsToAdd) {
    try {
      const isProUser = await this.isProUser(userId);
      const dailyLimit = isProUser
        ? POINTS_CONFIG.DAILY_LIMITS.PRO_USER
        : POINTS_CONFIG.DAILY_LIMITS.FREE_USER;

      const alreadyEarned = await this.getDailyPointsEarned(userId);
      const remaining = dailyLimit - alreadyEarned;

      console.log(`📊 Points Daily Limit Check:`, {
        user_id: userId,
        is_pro: isProUser,
        daily_limit: dailyLimit,
        already_earned: alreadyEarned,
        remaining,
        requested: pointsToAdd,
        can_earn: remaining > 0,
      });

      return remaining > 0;
    } catch (error) {
      console.error("❌ Error checking daily points limit:", error);
      return false;
    }
  }

  /**
   * Add points to user with transaction logging
   * @param {number} userId - User ID
   * @param {number} points - Points to add
   * @param {string} transactionType - Type of transaction
   * @param {number} relatedNodeId - ID of related post/comment/etc
   * @param {string} description - Description
   */
  static async addPoints(
    userId,
    points,
    transactionType = "manual",
    relatedNodeId = null,
    description = null,
  ) {
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      if (!userId || points <= 0) {
        console.warn("⚠️ Invalid userId or points:", { userId, points });
        return null;
      }

      // Check daily limit
      const canEarn = await this.canEarnMorePointsToday(userId, points);
      if (!canEarn) {
        console.warn("⚠️ Daily points limit reached for user:", userId);
        return null;
      }

      // Add points to user
      await connection.query(
        `UPDATE users SET user_points = user_points + ? WHERE user_id = ?`,
        [points, userId],
      );

      // Log transaction
      const [result] = await connection.query(
        `INSERT INTO users_points_transactions
         (user_id, points_earned, transaction_type, node_id, description, transaction_date)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [userId, points, transactionType, relatedNodeId, description],
      );

      await connection.commit();

      console.log(`✅ Points added:`, {
        user_id: userId,
        points,
        transaction_type: transactionType,
        node_id: relatedNodeId,
      });

      return {
        transaction_id: result.insertId,
        points_added: points,
        user_id: userId,
      };
    } catch (error) {
      await connection.rollback();
      console.error("❌ Error adding points:", error);
      return null;
    } finally {
      connection.release();
    }
  }

  /**
   * Deduct points from user
   */
  static async deductPoints(
    userId,
    points,
    transactionType = "manual",
    relatedNodeId = null,
    description = null,
  ) {
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      if (!userId || points <= 0) {
        console.warn("⚠️ Invalid userId or points:", { userId, points });
        return null;
      }

      // Check balance
      const [rows] = await connection.query(
        `SELECT user_points FROM users WHERE user_id = ?`,
        [userId],
      );

      if (!rows[0] || rows[0].user_points < points) {
        await connection.rollback();
        console.warn("⚠️ Insufficient points for user:", userId);
        return null;
      }

      // Deduct points
      await connection.query(
        `UPDATE users SET user_points = user_points - ? WHERE user_id = ?`,
        [points, userId],
      );

      // Log transaction
      const [result] = await connection.query(
        `INSERT INTO users_points_transactions
         (user_id, points_earned, transaction_type, node_id, description, transaction_date)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [userId, -points, transactionType, relatedNodeId, description],
      );

      await connection.commit();

      console.log(`✅ Points deducted:`, {
        user_id: userId,
        points,
        transaction_type: transactionType,
      });

      return {
        transaction_id: result.insertId,
        points_deducted: points,
        user_id: userId,
      };
    } catch (error) {
      await connection.rollback();
      console.error("❌ Error deducting points:", error);
      return null;
    } finally {
      connection.release();
    }
  }

  /**
   * Get user points summary
   */
  static async getUserPointsSummary(userId) {
    try {
      const [userRows] = await db.query(
        `SELECT user_points FROM users WHERE user_id = ?`,
        [userId],
      );

      if (!userRows[0]) return null;

      const currentPoints = userRows[0].user_points;
      const dailyEarned = await this.getDailyPointsEarned(userId);
      const isProUser = await this.isProUser(userId);
      const dailyLimit = isProUser
        ? POINTS_CONFIG.DAILY_LIMITS.PRO_USER
        : POINTS_CONFIG.DAILY_LIMITS.FREE_USER;

      return {
        total_points: currentPoints,
        daily_earned_today: dailyEarned,
        daily_limit: dailyLimit,
        remaining_today: Math.max(0, dailyLimit - dailyEarned),
        is_pro_user: isProUser,
      };
    } catch (error) {
      console.error("❌ Error getting points summary:", error);
      return null;
    }
  }
}

module.exports = PointsService;
