const db = require("../config/db");
const jwt = require("jsonwebtoken");
const fs = require("node:fs");
const path = require("node:path");
const { GoogleAuth } = require("google-auth-library");
const {
  decodeNotification,
  GRANTING_TYPES,
  REVOKING_TYPES,
} = require("../services/appleNotifications");

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
 * Pick the newest matching transaction from the App Store receipt.
 * Returns null when the receipt has no entry for this product.
 */
const appleTransactionFor = (result, productId) => {
  const infos = [
    ...(result?.latest_receipt_info || []),
    ...(result?.receipt?.in_app || []),
  ].filter((i) => i.product_id === productId);
  if (infos.length === 0) return null;

  // Newest first: expires_date_ms when present, otherwise purchase_date_ms.
  const sortKey = (i) =>
    Number(i.expires_date_ms || i.purchase_date_ms || 0);
  const newestFirst = [...infos].sort((a, b) => sortKey(b) - sortKey(a));
  return newestFirst[0];
};

const msToDate = (value) => {
  if (!value) return null;
  // Apple sends epoch milliseconds (number or numeric string); some fields
  // arrive as ISO-8601 strings instead.
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) return new Date(asNumber);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Grant a membership package to a user (no wallet charge - used for IAP).
 *
 * Idempotent: `packages_payments.transaction_id` carries a UNIQUE index, so a
 * repeated "Restore Purchases" (or a redelivered store notification) reuses the
 * existing row instead of inserting a duplicate payment.
 *
 * @returns {Promise<{alreadyGranted: boolean, paymentId: number|null}>}
 */
const grantPackageToUser = async (
  connection,
  pkg,
  userId,
  {
    platform = "wallet",
    storeProductId = null,
    transactionId = null,
    originalTransactionId = null,
    expiresDate = null,
  } = {},
) => {
  const amount = Number.parseFloat(pkg.price) || 0;
  const boostPosts = flagOn(pkg.boost_posts_enabled)
    ? Number(pkg.boost_posts || 0)
    : 0;
  const boostPages = flagOn(pkg.boost_pages_enabled)
    ? Number(pkg.boost_pages || 0)
    : 0;

  // Already recorded -> nothing to grant, but make sure boosts are intact.
  if (transactionId) {
    const [[existing]] = await connection.query(
      `SELECT payment_id FROM packages_payments
       WHERE transaction_id = ? LIMIT 1`,
      [transactionId],
    );
    if (existing) {
      return { alreadyGranted: true, paymentId: existing.payment_id };
    }
  }

  await connection.query(
    `UPDATE users
     SET user_verified = '1',
         user_boosted_posts = ?,
         user_boosted_pages = ?
     WHERE user_id = ?`,
    [boostPosts, boostPages, userId],
  );

  const [insertResult] = await connection.query(
    `INSERT INTO packages_payments
       (payment_date, package_name, package_price, user_id,
        store_product_id, platform, transaction_id, original_transaction_id,
        expires_date, auto_renew_status)
     VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?, ?, '1')`,
    [
      pkg.name,
      amount,
      userId,
      storeProductId,
      platform,
      transactionId,
      originalTransactionId,
      expiresDate,
    ],
  );

  return { alreadyGranted: false, paymentId: insertResult.insertId };
};

/**
 * Resolve the store-issued identifiers for an iOS purchase so the server can:
 *   - deduplicate repeated receipts (transactionId)
 *   - match future renewals to this user (originalTransactionId)
 *   - trust the store's expiry rather than guessing it
 */
const resolveAppleTransaction = async (productId, body) => {
  const { receipt } = body;
  if (!receipt) {
    throw Object.assign(new Error("receipt is required for iOS purchases"), {
      statusCode: 400,
    });
  }

  const result = await verifyAppleReceipt(receipt);
  if (result.status !== 0) {
    const message =
      {
        21000: "App Store environment error",
        21002: "receipt-data is malformed",
        21003: "Receipt could not be authenticated",
        21004: "Shared secret does not match",
        21005: "Receipt server unavailable",
        21008: "Wrong environment (production vs sandbox)",
      }[result.status] || `Apple verification failed (status ${result.status})`;
    throw Object.assign(new Error(message), { statusCode: 400 });
  }

  const tx = appleTransactionFor(result, productId);
  if (!tx) {
    throw Object.assign(
      new Error("No active subscription found for this product"),
      { statusCode: 400 },
    );
  }

  // A lapsed entry is not an entitlement.
  const expMs = Number(tx.expires_date_ms || 0);
  if (expMs > 0 && expMs <= Date.now()) {
    throw Object.assign(
      new Error(
        "This subscription has expired. Renew in the App Store to reactivate.",
      ),
      { statusCode: 400 },
    );
  }

  return {
    transactionId: tx.transaction_id || null,
    originalTransactionId:
      tx.original_transaction_id || tx.transaction_id || null,
    expiresDate: msToDate(expMs) || msToDate(tx.expires_date),
  };
};

/**
 * Resolve the store-issued identifiers for an Android purchase.
 * For Play, the purchase token is the stable subscription identifier.
 */
const resolveAndroidTransaction = async (body) => {
  const token =
    body.transactionId ||
    (typeof body.receipt === "string" ? body.receipt : null);
  if (!token) {
    throw Object.assign(
      new Error("transactionId is required for Android purchases"),
      { statusCode: 400 },
    );
  }

  const sub = await verifyGoogleSubscription(token);
  if (!googleSubscriptionActive(sub)) {
    throw Object.assign(
      new Error("No active subscription found for this purchase"),
      { statusCode: 400 },
    );
  }

  return {
    transactionId: token,
    originalTransactionId: token,
    expiresDate: sub.expiryTime ? new Date(sub.expiryTime) : null,
  };
};

/**
 * Dispatch to the per-platform verifier.
 */
const resolveStoreTransaction = (platform, productId, body) => {
  if (platform === "ios") return resolveAppleTransaction(productId, body);
  if (platform === "android") return resolveAndroidTransaction(body);
  throw Object.assign(new Error("platform must be 'ios' or 'android'"), {
    statusCode: 400,
  });
};

/**
 * POST /api/membership/iap/verify
 * Called by the app after a native StoreKit / Google Play purchase.
 * Body: { platform: 'ios'|'android', productId, transactionId?, receipt? }
 *  - ios:     `receipt` is the base64 transaction receipt
 *  - android: `transactionId` is the Play purchase token
 *
 * Idempotent - repeating the same receipt returns the existing membership
 * rather than inserting a second payment row.
 */
const verifyIapSubscription = async (req, res) => {
  const userId = req.user.id;
  const { platform, productId } = req.body || {};

  if (!platform || !productId) {
    return res.status(400).json({
      success: false,
      message: "platform and productId are required",
    });
  }

  let connection;
  try {
    const store = await resolveStoreTransaction(platform, productId, req.body);

    connection = await db.getConnection();
    await connection.beginTransaction();

    const pkg = await findPackageForProduct(connection, productId);
    if (!pkg) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "No membership plan matches this product",
      });
    }

    const { alreadyGranted, paymentId } = await grantPackageToUser(
      connection,
      pkg,
      userId,
      {
        platform,
        storeProductId: productId,
        transactionId: store.transactionId,
        originalTransactionId: store.originalTransactionId,
        expiresDate: store.expiresDate,
      },
    );
    await connection.commit();

    return res.json({
      success: true,
      message: alreadyGranted
        ? `Membership already active (${pkg.name})`
        : `Membership activated (${pkg.name})`,
      data: {
        package_id: pkg.package_id,
        package_name: pkg.name,
        package_price: Number.parseFloat(pkg.price) || 0,
        payment_id: paymentId,
        expires_date: store.expiresDate,
        already_granted: alreadyGranted,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("verifyIapSubscription error:", error.message);
    return res.status(error.statusCode || 500).json({
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
        pp.platform,
        pp.auto_renew_status,
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
        pp.expires_date,
        -- Prefer the store-reported expiry when we have it (authoritative for
        -- IAP subscriptions). Otherwise derive it from the package period.
        --
        -- LOWER() is deliberate: the packages.period values are stored as
        -- 'week'/'month' etc, while these WHEN labels are capitalised, and the
        -- comparison would only work by accident on a case-insensitive
        -- collation. On a _bin/_cs collation the old form fell through to the
        -- ELSE branch, which grants MONTHS for a weekly plan.
        COALESCE(
          pp.expires_date,
          CASE LOWER(p.period)
            WHEN 'day' THEN DATE_ADD(pp.payment_date, INTERVAL p.period_num DAY)
            WHEN 'week' THEN DATE_ADD(pp.payment_date, INTERVAL p.period_num WEEK)
            WHEN 'month' THEN DATE_ADD(pp.payment_date, INTERVAL p.period_num MONTH)
            WHEN 'year' THEN DATE_ADD(pp.payment_date, INTERVAL p.period_num YEAR)
            ELSE DATE_ADD(pp.payment_date, INTERVAL p.period_num MONTH)
          END
        ) as expiry_date
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

/**
 * Apply a renewal / grant notification: record the new payment (if unseen) and
 * keep the user entitled for the new period.
 */
const applyGrantingNotification = async (connection, ctx) => {
  const {
    notification,
    transaction,
    userId,
    originalTransactionId,
    productId,
    expiresMs,
  } = ctx;

  const txId = transaction?.transactionId || null;

  // Apple redelivers notifications; skip a transaction we already recorded.
  const [[dupe]] = txId
    ? await connection.query(
        `SELECT payment_id FROM packages_payments WHERE transaction_id = ? LIMIT 1`,
        [txId],
      )
    : [[null]];

  if (!dupe) {
    const pkg = await findPackageForProduct(connection, productId);
    if (pkg) {
      await connection.query(
        `INSERT INTO packages_payments
           (payment_date, package_name, package_price, user_id,
            store_product_id, platform, transaction_id, original_transaction_id,
            expires_date, auto_renew_status)
         VALUES (NOW(), ?, ?, ?, ?, 'ios', ?, ?, ?, '1')`,
        [
          pkg.name,
          Number.parseFloat(pkg.price) || 0,
          userId,
          productId,
          txId,
          originalTransactionId,
          msToDate(expiresMs),
        ],
      );
    }
  }

  await connection.query(
    `UPDATE users SET user_verified = '1' WHERE user_id = ?`,
    [userId],
  );

  // Users may switch auto-renew off and keep access until the period ends.
  if (notification.renewalInfo?.autoRenewStatus === 0) {
    await connection.query(
      `UPDATE packages_payments SET auto_renew_status = '0'
       WHERE original_transaction_id = ?`,
      [originalTransactionId],
    );
  }
};

/**
 * Apply an expiry / refund / revoke notification: end the entitlement.
 */
const applyRevokingNotification = async (connection, ctx) => {
  const { userId, originalTransactionId, expiresMs } = ctx;

  await connection.query(
    `UPDATE users
     SET user_verified = '0', user_boosted_posts = 0, user_boosted_pages = 0
     WHERE user_id = ?`,
    [userId],
  );
  await connection.query(
    `UPDATE packages_payments
     SET auto_renew_status = '0', expires_date = ?
     WHERE original_transaction_id = ?`,
    [msToDate(expiresMs) || new Date(), originalTransactionId],
  );
};

/**
 * POST /api/membership/app-store-notifications
 * App Store Server Notifications V2 webhook (configure this URL in
 * App Store Connect -> App Information -> App Store Server Notifications).
 *
 * Handles the renewal lifecycle so memberships do not silently expire at every
 * billing period. Apple retries non-2xx responses, so once the payload is
 * authentic and understood we return 200; transient failures return 500 so
 * Apple retries.
 *
 * No auth middleware: Apple calls this server-to-server. Authenticity comes
 * from the JWS signature chain, not a bearer token.
 */
const handleAppStoreNotification = async (req, res) => {
  const { signedPayload } = req.body || {};

  if (!signedPayload) {
    return res
      .status(400)
      .json({ success: false, message: "signedPayload is required" });
  }

  let notification;
  try {
    notification = decodeNotification(signedPayload);
  } catch (error) {
    console.error("App Store notification verification failed:", error.message);
    return res.status(401).json({ success: false, message: "Invalid signature" });
  }

  const { notificationType, subtype, transaction } = notification;
  const subtypeLabel = subtype ? `/${subtype}` : "";
  console.log(`App Store notification: ${notificationType}${subtypeLabel}`);

  const originalTransactionId = transaction?.originalTransactionId;
  const productId = transaction?.productId;
  const expiresMs = Number(transaction?.expiresDate || 0);

  if (!originalTransactionId) {
    return res
      .status(200)
      .json({ success: true, ignored: "no originalTransactionId" });
  }

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // Correlate to a local user via any prior grant of this subscription.
    const [[existing]] = await connection.query(
      `SELECT user_id FROM packages_payments
       WHERE original_transaction_id = ?
       ORDER BY payment_date DESC LIMIT 1`,
      [originalTransactionId],
    );

    if (!existing) {
      await connection.rollback();
      console.warn(
        `App Store notification for unknown subscription ${originalTransactionId} (${notificationType}) - nothing to update.`,
      );
      return res
        .status(200)
        .json({ success: true, ignored: "unknown subscription" });
    }

    const ctx = {
      notification,
      transaction,
      userId: existing.user_id,
      originalTransactionId,
      productId,
      expiresMs,
    };

    if (GRANTING_TYPES.has(notificationType)) {
      await applyGrantingNotification(connection, ctx);
    } else if (REVOKING_TYPES.has(notificationType)) {
      await applyRevokingNotification(connection, ctx);
    } else {
      // e.g. DID_CHANGE_RENEWAL_STATUS, CONSUMPTION_REQUEST - no entitlement
      // change. Acknowledge so Apple stops retrying.
      await connection.rollback();
      return res.status(200).json({ success: true, ignored: notificationType });
    }

    await connection.commit();
    return res.status(200).json({ success: true, handled: notificationType });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("handleAppStoreNotification error:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Failed to process notification" });
  } finally {
    if (connection) connection.release();
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
  handleAppStoreNotification,
};
