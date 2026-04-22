const db = require("../config/db");
const jwt = require("jsonwebtoken");

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
        allowed_products
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

    // Get the latest active package payment for the user
    const query = `
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
        DATE_ADD(pp.payment_date, INTERVAL p.period_num ${getIntervalUnit(p.period)}) as expiry_date
      FROM packages_payments pp
      JOIN packages p ON pp.package_name = p.name
      WHERE pp.user_id = ?
      ORDER BY pp.payment_date DESC
      LIMIT 1
    `;

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
        p.allowed_products
      FROM packages_payments pp
      JOIN packages p ON pp.package_name = p.name
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

    res.status(200).json({
      success: true,
      data: userPackage,
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
        p.post_text,
        p.user_id,
        u.user_name,
        u.user_picture,
        p.boosted_by,
        p.created_at,
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
      AND p.created_at >= ?
      ORDER BY p.created_at DESC
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
        p.created_at,
        u.user_name
      FROM pages p
      JOIN users u ON p.page_admin = u.user_id
      WHERE p.page_boosted_by = ?
      AND p.created_at >= ?
      ORDER BY p.created_at DESC
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

module.exports = {
  getAllPackages,
  getUserPackage,
  getUserBoostedPosts,
  getUserBoostedPages,
};
