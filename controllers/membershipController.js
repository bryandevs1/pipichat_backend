const db = require("../config/db");
const jwt = require("jsonwebtoken");

const getExpiryDate = (paymentDate, period, periodNum) => {
  const baseDate = new Date(paymentDate);
  const amount = Number(periodNum) || 1;

  if (Number.isNaN(baseDate.getTime())) {
    return null;
  }

  const expiry = new Date(baseDate);

  switch (period) {
    case "Day":
      expiry.setDate(expiry.getDate() + amount);
      break;
    case "Week":
      expiry.setDate(expiry.getDate() + amount * 7);
      break;
    case "Month":
      expiry.setMonth(expiry.getMonth() + amount);
      break;
    case "Year":
      expiry.setFullYear(expiry.getFullYear() + amount);
      break;
    default:
      expiry.setMonth(expiry.getMonth() + amount);
      break;
  }

  return expiry;
};

/**
 * Get all available membership packages
 */
const getAllPackages = async (req, res) => {
  try {
    const query = `
      SELECT 
        package_id,
        name,
        price,
        period,
        period_num,
        color,
        icon,
        custom_description,
        verification_badge_enabled,
        boost_posts_enabled,
        boost_posts,
        boost_pages_enabled,
        boost_pages,
        allowed_blogs_categories,
        allowed_videos_categories,
        allowed_products,
        package_hidden,
        free_points,
        boost_events_enabled,
        boost_events
      FROM packages
      ORDER BY package_order ASC
    `;

    const [packages] = await db.query(query);

    res.status(200).json({
      success: true,
      data: packages,
    });
  } catch (error) {
    console.error("Error fetching packages:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch packages",
      error: error.message,
    });
  }
};

/**
 * Get user's current package subscription
 */
const getUserPackage = async (req, res) => {
  try {
    const userId = req.user.id;

    // Simple version without dynamic interval
    const simpleQuery = `
      SELECT 
        pp.payment_id,
        pp.payment_date,
        pp.package_name,
        pp.package_price,
        pp.user_id,
        p.package_id,
        p.price,
        p.period,
        p.period_num,
        p.color,
        p.icon,
        p.custom_description,
        p.verification_badge_enabled,
        p.boost_posts_enabled,
        p.boost_posts,
        p.boost_pages_enabled,
        p.boost_pages,
        p.allowed_blogs_categories,
        p.allowed_videos_categories,
        p.allowed_products,
        u.user_verified,
        u.user_boosted_posts,
        u.user_boosted_pages,
        CASE p.period
          WHEN 'Day' THEN DATE_ADD(pp.payment_date, INTERVAL p.period_num DAY)
          WHEN 'Week' THEN DATE_ADD(pp.payment_date, INTERVAL p.period_num WEEK)
          WHEN 'Month' THEN DATE_ADD(pp.payment_date, INTERVAL p.period_num MONTH)
          WHEN 'Year' THEN DATE_ADD(pp.payment_date, INTERVAL p.period_num YEAR)
          ELSE DATE_ADD(pp.payment_date, INTERVAL p.period_num MONTH)
        END as expiry_date
      FROM packages_payments pp
      JOIN packages p ON pp.package_name = p.name
      JOIN users u ON pp.user_id = u.user_id
      WHERE pp.user_id = ?
      ORDER BY pp.payment_date DESC
      LIMIT 1
    `;

    const [[userPackage]] = await db.query(simpleQuery, [userId]);

    if (!userPackage) {
      return res.status(200).json({
        success: true,
        data: null,
        message: "User has no active package",
      });
    }

    const expiryDate = new Date(userPackage.expiry_date);
    const now = new Date();
    const isActive = !Number.isNaN(expiryDate.getTime()) && expiryDate > now;

    if (!isActive) {
      return res.status(200).json({
        success: true,
        data: null,
        message: "User package has expired",
      });
    }

    // Fallback to package defaults if user's boosted values are 0
    // (handles fresh subscriptions where the user table hasn't been updated yet)
    const boostPostsFromUser = Number(userPackage.user_boosted_posts || 0);
    const boostPagesFromUser = Number(userPackage.user_boosted_pages || 0);
    const boostPostsFromPkg = Number(userPackage.boost_posts || 0);
    const boostPagesFromPkg = Number(userPackage.boost_pages || 0);

    res.status(200).json({
      success: true,
      data: {
        ...userPackage,
        user_verified: userPackage.user_verified === "1",
        is_active: true,
        remaining_boosted_posts: boostPostsFromUser || boostPostsFromPkg,
        remaining_boosted_pages: boostPagesFromUser || boostPagesFromPkg,
        days_left: Math.max(
          0,
          Math.ceil(
            (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
          ),
        ),
      },
    });
  } catch (error) {
    console.error("Error fetching user package:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user package",
      error: error.message,
    });
  }
};

/**
 * Purchase / activate a membership package.
 * This auto-verifies the user and refreshes boost quotas.
 */
const subscribeToPackage = async (req, res) => {
  const { package_id } = req.body;
  const userId = req.user.id;

  if (!package_id) {
    return res.status(400).json({
      success: false,
      message: "package_id is required",
    });
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [[pkg]] = await connection.query(
      `SELECT * FROM packages WHERE package_id = ? LIMIT 1 FOR UPDATE`,
      [package_id],
    );

    if (!pkg) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Package not found",
      });
    }

    const [[userRow]] = await connection.query(
      `SELECT user_wallet_balance FROM users WHERE user_id = ? LIMIT 1 FOR UPDATE`,
      [userId],
    );

    if (!userRow) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const amount = Number.parseFloat(pkg.price);

    if (Number.isNaN(amount) || amount <= 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Package price is invalid",
      });
    }

    if (Number.parseFloat(userRow.user_wallet_balance || 0) < amount) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Insufficient wallet balance",
      });
    }

    await connection.query(
      `UPDATE users
       SET user_wallet_balance = user_wallet_balance - ?,
           user_verified = '1',
           user_boosted_posts = ?,
           user_boosted_pages = ?
       WHERE user_id = ?`,
      [
        amount,
        Number(pkg.boost_posts_enabled) === 1 ||
        String(pkg.boost_posts_enabled) === "1"
          ? Number(pkg.boost_posts || 0)
          : 0,
        Number(pkg.boost_pages_enabled) === 1 ||
        String(pkg.boost_pages_enabled) === "1"
          ? Number(pkg.boost_pages || 0)
          : 0,
        userId,
      ],
    );

    await connection.query(
      `INSERT INTO packages_payments (payment_date, package_name, package_price, user_id)
       VALUES (NOW(), ?, ?, ?)`,
      [pkg.name, amount, userId],
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: `Package ${pkg.name} activated successfully`,
      data: {
        package_id: pkg.package_id,
        package_name: pkg.name,
        package_price: amount,
        boost_posts_enabled:
          pkg.boost_posts_enabled === "1" || pkg.boost_posts_enabled === 1,
        boost_posts: Number(pkg.boost_posts || 0),
        boost_pages_enabled:
          pkg.boost_pages_enabled === "1" || pkg.boost_pages_enabled === 1,
        boost_pages: Number(pkg.boost_pages || 0),
        verification_badge_enabled:
          pkg.verification_badge_enabled === "1" ||
          pkg.verification_badge_enabled === 1,
        user_verified: true,
        remaining_boosted_posts: Number(pkg.boost_posts || 0),
        remaining_boosted_pages: Number(pkg.boost_pages || 0),
      },
    });
  } catch (error) {
    await connection.rollback();
    console.error("subscribeToPackage error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to activate package",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

/**
 * Get posts boosted by the user since their current plan started
 */
const getUserBoostedPosts = async (req, res) => {
  try {
    const userId = req.user.id;

    // First, get when the current membership period started
    const packageQuery = `
      SELECT pp.payment_date
      FROM packages_payments pp
      WHERE pp.user_id = ?
      ORDER BY pp.payment_date DESC
      LIMIT 1
    `;

    const [[packagePayment]] = await db.query(packageQuery, [userId]);

    if (!packagePayment) {
      return res.status(200).json({
        success: true,
        data: [],
        message: "No boosted posts",
      });
    }

    // Get all boosted posts since membership started
    const postsQuery = `
      SELECT 
        p.post_id,
        p.text AS post_text,
        p.user_id,
        u.user_name,
        u.user_picture,
        p.boosted_by,
        p.time AS created_at,
        p.views,
        p.comments,
        p.shares,
        COALESCE(
          (SELECT COUNT(*) FROM posts_reactions WHERE post_id = p.post_id),
          0
        ) as total_reactions
      FROM posts p
      JOIN users u ON p.user_id = u.user_id
      WHERE p.boosted_by = ?
      AND p.time >= ?
      ORDER BY p.time DESC
      LIMIT 20
    `;

    const [posts] = await db.query(postsQuery, [
      userId,
      packagePayment.payment_date,
    ]);

    res.status(200).json({
      success: true,
      data: posts,
      membershipStartDate: packagePayment.payment_date,
    });
  } catch (error) {
    console.error("Error fetching user boosted posts:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch boosted posts",
      error: error.message,
    });
  }
};

/**
 * Get pages boosted by the user since their current plan started
 */
const getUserBoostedPages = async (req, res) => {
  try {
    const userId = req.user.id;

    // First, get when the current membership period started
    const packageQuery = `
      SELECT pp.payment_date
      FROM packages_payments pp
      WHERE pp.user_id = ?
      ORDER BY pp.payment_date DESC
      LIMIT 1
    `;

    const [[packagePayment]] = await db.query(packageQuery, [userId]);

    if (!packagePayment) {
      return res.status(200).json({
        success: true,
        data: [],
        message: "No boosted pages",
      });
    }

    // Get all boosted pages since membership started
    const pagesQuery = `
      SELECT 
        p.page_id,
        p.page_name,
        p.page_admin,
        p.page_picture_id,
        p.page_boosted_by,
        p.page_date AS created_at,
        u.user_name
      FROM pages p
      JOIN users u ON p.page_admin = u.user_id
      WHERE p.page_boosted_by = ?
      AND p.page_date >= ?
      ORDER BY p.page_date DESC
      LIMIT 20
    `;

    const [pages] = await db.query(pagesQuery, [
      userId,
      packagePayment.payment_date,
    ]);

    res.status(200).json({
      success: true,
      data: pages,
      membershipStartDate: packagePayment.payment_date,
    });
  } catch (error) {
    console.error("Error fetching user boosted pages:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch boosted pages",
      error: error.message,
    });
  }
};

/**
 * Helper function to get SQL interval unit
 */
function getIntervalUnit(period) {
  const periodMap = {
    Day: "DAY",
    Week: "WEEK",
    Month: "MONTH",
    Year: "YEAR",
  };
  return periodMap[period] || "MONTH";
}

/**
 * Cancel / unsubscribe from current membership package.
 * Clears verification badge and boost quotas.
 */
const cancelSubscription = async (req, res) => {
  const userId = req.user.id;

  try {
    const [[currentPackage]] = await db.query(
      `SELECT pp.payment_id, pp.package_name
       FROM packages_payments pp
       WHERE pp.user_id = ?
       ORDER BY pp.payment_date DESC
       LIMIT 1`,
      [userId],
    );

    if (!currentPackage) {
      return res.status(400).json({
        success: false,
        message: "You do not have an active membership to cancel.",
      });
    }

    // Reset user verification and boost quotas
    await db.query(
      `UPDATE users
       SET user_verified = '0',
           user_boosted_posts = 0,
           user_boosted_pages = 0
       WHERE user_id = ?`,
      [userId],
    );

    // Remove the payment record and reset boost/verification
    await db.query(
      `DELETE FROM packages_payments
       WHERE payment_id = ? AND user_id = ?`,
      [currentPackage.payment_id, userId],
    );

    return res.status(200).json({
      success: true,
      message: `Your "${currentPackage.package_name}" membership has been cancelled.`,
    });
  } catch (error) {
    console.error("cancelSubscription error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to cancel membership",
      error: error.message,
    });
  }
};

module.exports = {
  getAllPackages,
  getUserPackage,
  getUserBoostedPosts,
  getUserBoostedPages,
  subscribeToPackage,
  cancelSubscription,
};
