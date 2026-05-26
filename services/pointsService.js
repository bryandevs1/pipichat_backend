/**
 * Points/Coins Helper Service
 * Handles balances, daily limits, and source-table point tracking.
 */

const db = require("../config/db");
const POINTS_CONFIG = require("../utils/pointsConfig");

const DAILY_POINT_SOURCES = {
  post_created: {
    table: "posts",
    userColumn: "user_id",
    idColumn: "post_id",
    pointsColumn: "points_earned",
  },
  comment_created: {
    table: "posts_comments",
    userColumn: "user_id",
    idColumn: "comment_id",
    pointsColumn: "points_earned",
  },
  post_view: {
    table: "posts_views",
    userColumn: "user_id",
    pointsColumn: null,
  },
  reaction: {
    table: "posts_reactions",
    userColumn: "user_id",
    idColumn: "id",
    pointsColumn: "points_earned",
  },
  comment_reaction: {
    table: "posts_comments_reactions",
    userColumn: "user_id",
    idColumn: "id",
    pointsColumn: "points_earned",
  },
  follower_gained: {
    table: "followings",
    userColumn: "following_id",
    idColumn: "id",
    pointsColumn: "points_earned",
  },
};

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

  static getSourceConfig(transactionType) {
    return DAILY_POINT_SOURCES[transactionType] || null;
  }

  static async markSourceAsRewarded(
    connection,
    userId,
    transactionType,
    relatedNodeId,
  ) {
    const config = this.getSourceConfig(transactionType);
    if (!config?.pointsColumn || relatedNodeId == null) {
      return { tracked: false };
    }

    const [existingRows] = await connection.query(
      `SELECT ${config.pointsColumn} AS points_earned
       FROM ${config.table}
       WHERE ${config.idColumn} = ? AND ${config.userColumn} = ?
       LIMIT 1`,
      [relatedNodeId, userId],
    );

    if (existingRows.length === 0) {
      return { tracked: false, found: false };
    }

    if (String(existingRows[0].points_earned) === "1") {
      return { tracked: true, alreadyRewarded: true };
    }

    const [updateResult] = await connection.query(
      `UPDATE ${config.table}
       SET ${config.pointsColumn} = '1'
       WHERE ${config.idColumn} = ? AND ${config.userColumn} = ? AND ${config.pointsColumn} = '0'`,
      [relatedNodeId, userId],
    );

    return {
      tracked: true,
      alreadyRewarded: updateResult.affectedRows === 0,
      rewarded: updateResult.affectedRows > 0,
    };
  }

  /**
   * Get daily points earned by user (today)
   */
  static async getDailyPointsEarned(userId) {
    try {
      const [rows] = await db.query(
        `SELECT COALESCE(SUM(points_total), 0) AS total
         FROM (
           SELECT COALESCE(SUM(CASE WHEN points_earned = '1' THEN ? ELSE 0 END), 0) AS points_total
           FROM posts
           WHERE user_id = ? AND DATE(time) = CURDATE()

           UNION ALL

           SELECT COALESCE(SUM(CASE WHEN points_earned = '1' THEN ? ELSE 0 END), 0) AS points_total
           FROM posts_comments
           WHERE user_id = ? AND DATE(time) = CURDATE()

           UNION ALL

           SELECT COALESCE(COUNT(*) * ?, 0) AS points_total
           FROM posts_views
           WHERE user_id = ? AND DATE(view_date) = CURDATE()

           UNION ALL

           SELECT COALESCE(SUM(CASE WHEN points_earned = '1' THEN ? ELSE 0 END), 0) AS points_total
           FROM posts_reactions
           WHERE user_id = ? AND DATE(reaction_time) = CURDATE()

           UNION ALL

           SELECT COALESCE(SUM(CASE WHEN points_earned = '1' THEN ? ELSE 0 END), 0) AS points_total
           FROM posts_comments_reactions
           WHERE user_id = ? AND DATE(reaction_time) = CURDATE()

           UNION ALL

           SELECT COALESCE(SUM(CASE WHEN points_earned = '1' THEN ? ELSE 0 END), 0) AS points_total
           FROM followings
           WHERE following_id = ? AND DATE(time) = CURDATE()
         ) AS daily_points`,
        [
          POINTS_CONFIG.ACTIVITIES.POST_CREATED,
          userId,
          POINTS_CONFIG.ACTIVITIES.COMMENT_CREATED,
          userId,
          POINTS_CONFIG.ACTIVITIES.POST_VIEWED,
          userId,
          POINTS_CONFIG.ACTIVITIES.REACTION_GIVEN,
          userId,
          POINTS_CONFIG.ACTIVITIES.REACTION_GIVEN,
          userId,
          POINTS_CONFIG.ACTIVITIES.FOLLOWER_GAINED,
          userId,
        ],
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
      const canEarn = remaining >= pointsToAdd;

      console.log(`📊 Points Daily Limit Check:`, {
        user_id: userId,
        is_pro: isProUser,
        daily_limit: dailyLimit,
        already_earned: alreadyEarned,
        remaining,
        requested: pointsToAdd,
        can_earn: canEarn,
      });

      return canEarn;
    } catch (error) {
      console.error("❌ Error checking daily points limit:", error);
      return false;
    }
  }

  /**
   * Add points to user balance and mark the source row when available.
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
        await connection.rollback();
        return null;
      }

      const canEarn = await this.canEarnMorePointsToday(userId, points);
      if (!canEarn) {
        console.warn("⚠️ Daily points limit reached for user:", userId);
        await connection.rollback();
        return null;
      }

      const sourceState = await this.markSourceAsRewarded(
        connection,
        userId,
        transactionType,
        relatedNodeId,
      );

      if (sourceState?.alreadyRewarded) {
        await connection.rollback();
        console.warn("⚠️ Points already rewarded for source event:", {
          user_id: userId,
          transaction_type: transactionType,
          node_id: relatedNodeId,
        });
        return null;
      }

      await connection.query(
        `UPDATE users SET user_points = user_points + ? WHERE user_id = ?`,
        [points, userId],
      );

      await connection.commit();

      console.log(`✅ Points added:`, {
        user_id: userId,
        points,
        transaction_type: transactionType,
        node_id: relatedNodeId,
        description,
      });

      return {
        points_added: points,
        user_id: userId,
        transaction_type: transactionType,
        node_id: relatedNodeId,
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
   * Deduct points from user balance.
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
        await connection.rollback();
        return null;
      }

      const [rows] = await connection.query(
        `SELECT user_points FROM users WHERE user_id = ? FOR UPDATE`,
        [userId],
      );

      if (!rows[0] || Number(rows[0].user_points) < points) {
        await connection.rollback();
        console.warn("⚠️ Insufficient points for user:", userId);
        return null;
      }

      await connection.query(
        `UPDATE users SET user_points = user_points - ? WHERE user_id = ?`,
        [points, userId],
      );

      await connection.commit();

      console.log(`✅ Points deducted:`, {
        user_id: userId,
        points,
        transaction_type: transactionType,
        node_id: relatedNodeId,
        description,
      });

      return {
        points_deducted: points,
        user_id: userId,
        transaction_type: transactionType,
        node_id: relatedNodeId,
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

      const currentPoints = Number(userRows[0].user_points || 0);
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
