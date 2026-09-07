const db = require("../config/db");
const jwt = require("jsonwebtoken");
const fs = require("node:fs");
const path = require("node:path");
const { GoogleAuth } = require("google-auth-library");

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

// ─────────────────────────────────────────────────────────────────────────────
// In-App Purchase (StoreKit / Google Play) verification
// ─────────────────────────────────────────────────────────────────────────────

const httpPostJson = async (url, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
};

/**
 * Verify an iOS receipt against Apple's verifyReceipt endpoint.
 * Returns the parsed response (status 0 == valid).
 */
const verifyAppleReceipt = async (receipt) => {
  const secret = process.env.APPLE_SHARED_SECRET;
  if (!secret || !receipt) {
    throw new Error("Apple IAP is not configured (missing APPLE_SHARED_SECRET)");
  }

  const payload = {
    "receipt-data": receipt,
    password: secret,
    "exclude-old-transactions": true,
  };

  const prod = await httpPostJson(
    "https://buy.itunes.apple.com/verifyReceipt",
    payload,
  );

  // 21007 = receipt from the sandbox environment - retry against sandbox.
  if (prod.status === 21007) {
    return httpPostJson(
      "https://sandbox.itunes.apple.com/verifyReceipt",
      payload,
    );
  }

  return prod;
};

const appleEntitlementActive = (result, productId) => {
  if (!result || result.status !== 0) return false;
  const infos = result.latest_receipt_info || [];
  const match = infos.find((i) => i.product_id === productId);
  if (!match) return false;
  const nowMs = Date.now();
  const expMs = Number(match.expires_date_ms);
  if (expMs && expMs > nowMs) return true;
  if (match.expires_date && new Date(match.expires_date).getTime() > nowMs) {
    return true;
  }
  // Non-expiring entitlement -> treat as valid.
  return !match.expires_date_ms && !match.expires_date;
};

let cachedGoogleToken = null;
let cachedGoogleTokenAt = 0;

const getGoogleAccessToken = async () => {
  const keyFile = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!keyFile) {
    throw new Error(
      "Google Play IAP is not configured (missing GOOGLE_PLAY_SERVICE_ACCOUNT_JSON)",
    );
  }
  const abs = path.resolve(keyFile);
  if (!fs.existsSync(abs)) {
    throw new Error(`Google Play service account file not found: ${abs}`);
  }

  // Tokens are valid for ~1h; cache for 55 min.
  if (cachedGoogleToken && Date.now() - cachedGoogleTokenAt < 55 * 60 * 1000) {
    return cachedGoogleToken;
  }

  const auth = new GoogleAuth({
    keyFile: abs,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });
  const token = await auth.getAccessToken();
  cachedGoogleToken = token;
  cachedGoogleTokenAt = Date.now();
  return token;
};

/**
 * Verify an Android purchase token against the Google Play Developer API
 * (subscriptionsv2). Returns the subscription object if valid.
 */
const verifyGoogleSubscription = async (purchaseToken) => {
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;
  if (!packageName) {
    throw new Error(
      "Google Play IAP is not configured (missing GOOGLE_PLAY_PACKAGE_NAME)",
    );
  }
  const accessToken = await getGoogleAccessToken();
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Play verification failed (${res.status}): ${text}`);
  }
  return res.json();
};

const googleSubscriptionActive = (sub) => {
  if (!sub) return false;
  const expiry = sub.expiryTime ? new Date(sub.expiryTime).getTime() : 0;
  return expiry > Date.now();
};

const findPackageForProduct = async (connection, productId) => {
  // Weekly is the default plan product (pipipremiumweekly).
  let like = "%Week%";
  if (/month/i.test(productId)) like = "%Month%";
  else if (/year|annual/i.test(productId)) like = "%Year%";
  const [rows] = await connection.query(
    `SELECT * FROM packages WHERE period LIKE ? ORDER BY package_id ASC LIMIT 1`,
    [like],
  );
  return rows[0] || null;
};

const flagOn = (v) => v === "1" || v === 1 || String(v) === "true";

/**
 * Grant a membership package to a user (no wallet charge - used for IAP).
 */
const grantPackageToUser = async (connection, pkg, userId) => {
  const amount = Number.parseFloat(pkg.price) || 0;
  const boostPosts = flagOn(pkg.boost_posts_enabled)
    ? Number(pkg.boost_posts || 0)
    : 0;
  const boostPages = flagOn(pkg.boost_pages_enabled)
    ? Number(pkg.boost_pages || 0)
    : 0;

  await connection.query(
    `UPDATE users
     SET user_verified = '1',
         user_boosted_posts = ?,
         user_boosted_pages = ?
     WHERE user_id = ?`,
    [boostPosts, boostPages, userId],
  );

  await connection.query(
    `INSERT INTO packages_payments (payment_date, package_name, package_price, user_id)
     VALUES (NOW(), ?, ?, ?)`,
    [pkg.name, amount, userId],
  );
};

/**
 * POST /api/membership/iap/verify
 * Called by the app after a native StoreKit / Google Play purchase.
 * Body: { platform: 'ios'|'android', productId, transactionId?, receipt? }
 *  - ios:     `receipt` is the base64 transaction receipt
 *  - android: `transactionId` is the Play purchase token
 */
const verifyIapSubscription = async (req, res) => {
  const userId = req.user.id;
  const { platform, productId, transactionId, receipt } = req.body || {};

  if (!platform || !productId) {
    return res.status(400).json({
      success: false,
      message: "platform and productId are required",
    });
  }

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    if (platform === "ios") {
      if (!receipt) {
        return res.status(400).json({
          success: false,
          message: "receipt is required for iOS purchases",
        });
      }
      const result = await verifyAppleReceipt(receipt);
      if (result.status !== 0) {
        const message = {
          21000: "App Store environment error",
          21002: "receipt-data is malformed",
          21003: "Receipt could not be authenticated",
          21004: "Shared secret does not match",
          21005: "Receipt server unavailable",
          21008: "Wrong environment (production vs sandbox)",
        }[result.status] || `Apple verification failed (status ${result.status})`;
        return res
          .status(400)
          .json({ success: false, message });
      }
      if (!appleEntitlementActive(result, productId)) {
        return res.status(400).json({
          success: false,
          message: "No active subscription found for this product",
        });
      }
    } else if (platform === "android") {
      const token = transactionId || (typeof receipt === "string" ? receipt : null);
      if (!token) {
        return res.status(400).json({
          success: false,
          message: "transactionId is required for Android purchases",
        });
      }
      const sub = await verifyGoogleSubscription(token);
      if (!googleSubscriptionActive(sub)) {
        return res.status(400).json({
          success: false,
          message: "No active subscription found for this purchase",
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        message: "platform must be 'ios' or 'android'",
      });
    }

    const pkg = await findPackageForProduct(connection, productId);
    if (!pkg) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "No membership plan matches this product",
      });
    }

    await grantPackageToUser(connection, pkg, userId);
    await connection.commit();

    return res.json({
      success: true,
      message: `Membership activated (${pkg.name})`,
      data: {
        package_id: pkg.package_id,
        package_name: pkg.name,
        package_price: Number.parseFloat(pkg.price) || 0,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("verifyIapSubscription error:", error.message);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to verify IAP purchase",
    });
  } finally {
    if (connection) connection.release();
  }
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
  verifyIapSubscription,
};
