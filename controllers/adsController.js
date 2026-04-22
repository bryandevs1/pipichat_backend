// controllers/adsController.js

const pool = require("../config/db");
const storageManager = require("../utils/storageManager");
const path = require("path");
const fs = require("fs").promises;

// ============================================================
//  CUSTOM ERRORS
// ============================================================

class AdsError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
  }
}

class AdsNotFoundError extends AdsError {
  constructor(message = "Ad campaign not found") {
    super(message, 404);
  }
}

class UnauthorizedAdsError extends AdsError {
  constructor(message = "Unauthorized access") {
    super(message, 403);
  }
}

class ValidationAdsError extends AdsError {
  constructor(message = "Validation failed") {
    super(message, 400);
  }
}

class InsufficientBalanceError extends AdsError {
  constructor(message = "Insufficient wallet balance") {
    super(message, 402);
  }
}

// ============================================================
//  PRIVATE HELPERS
// ============================================================

const normalizeEnum01 = (value) => {
  if (value === undefined) return undefined;
  if (value === "1" || value === 1 || value === true) return "1";
  return "0";
};

const handleBase64Upload = async (base64String, filename, folder) => {
  try {
    const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      throw new Error("Invalid base64 string");
    }
    const mimeType = matches[1];
    const buffer = Buffer.from(matches[2], "base64");
    const extension = mimeType.split("/")[1] || "jpg";
    const fullFilename = filename.includes(".")
      ? filename
      : `${filename}.${extension}`;
    const tempPath = path.join("/tmp", fullFilename);
    await fs.writeFile(tempPath, buffer);
    const file = {
      path: tempPath,
      originalname: fullFilename,
      mimetype: mimeType,
      size: buffer.length,
      buffer: buffer,
    };
    const result = await storageManager.upload(file, folder);
    try {
      await fs.unlink(tempPath);
    } catch (cleanupError) {
      console.log("Failed to delete temp file:", cleanupError.message);
    }
    return result;
  } catch (error) {
    console.error("Base64 upload error:", error);
    throw new Error(`Failed to process base64 upload: ${error.message}`);
  }
};

// ============================================================
//  CONTROLLER
// ============================================================

class AdsController {
  // ─────────────────────────────────────────────────────────
  //  HELPERS
  // ─────────────────────────────────────────────────────────

  static getCurrentUserId(req) {
    return (
      req.user?.id || req.user?.user_id || req.user?.uid || req.userId || null
    );
  }

  /** Returns { balance, sufficient } */
  static async checkWalletBalance(userId, requiredAmount) {
    const [[user]] = await pool.query(
      `SELECT user_wallet_balance FROM users WHERE user_id = ?`,
      [userId],
    );
    if (!user) throw new AdsNotFoundError("User not found");
    const balance = parseFloat(user.user_wallet_balance) || 0;
    return { balance, sufficient: balance >= parseFloat(requiredAmount) };
  }

  /** Deduct amount from user wallet and record the transaction */
  static async deductWallet(userId, amount, campaignId) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `UPDATE users SET user_wallet_balance = user_wallet_balance - ? WHERE user_id = ?`,
        [amount, userId],
      );
      await conn.query(
        `INSERT INTO wallet_transactions
           (user_id, node_type, node_id, amount, type, description, date)
         VALUES (?, 'ads_campaign', ?, ?, 'out', 'Ad campaign budget deduction', NOW())`,
        [userId, campaignId, amount.toString()],
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /** Pause the campaign if spend has reached / exceeded budget */
  static async pauseIfBudgetExhausted(campaignId, currentSpend, budget) {
    if (parseFloat(currentSpend) >= parseFloat(budget)) {
      await pool.query(
        `UPDATE ads_campaigns SET campaign_is_active = '0' WHERE campaign_id = ?`,
        [campaignId],
      );
    }
  }

  // ─────────────────────────────────────────────────────────
  //  WALLET BALANCE  (public endpoint for frontend check)
  // ─────────────────────────────────────────────────────────

  /**
   * GET /ads/wallet-balance
   * Returns current user's wallet balance.
   */
  static async getWalletBalance(req, res) {
    try {
      const userId = AdsController.getCurrentUserId(req);
      if (!userId) throw new UnauthorizedAdsError();

      const [[user]] = await pool.query(
        `SELECT user_wallet_balance FROM users WHERE user_id = ?`,
        [userId],
      );
      if (!user) throw new AdsNotFoundError("User not found");

      return res.json({
        success: true,
        balance: parseFloat(user.user_wallet_balance) || 0,
      });
    } catch (err) {
      return AdsController._handleError(res, err);
    }
  }

  // ─────────────────────────────────────────────────────────
  //  LIST  –  PUBLIC ADS (for the ad renderer)
  // ─────────────────────────────────────────────────────────

  /**
   * GET /ads
   * Returns approved, active, in-schedule campaigns.
   * Query params: placement, page, limit
   */
  static async getAllAds(req, res) {
    try {
      const { placement, page = 1, limit = 20 } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const conditions = [
        `campaign_is_active = '1'`,
        `campaign_is_approved = '1'`,
        `campaign_is_declined = '0'`,
        `campaign_start_date <= NOW()`,
        `campaign_end_date >= NOW()`,
      ];
      const params = [];

      if (placement) {
        conditions.push(`ads_placement = ?`);
        params.push(placement);
      }

      const where = `WHERE ${conditions.join(" AND ")}`;
      const [[{ total }]] = await pool.query(
        `SELECT COUNT(*) AS total FROM ads_campaigns ${where}`,
        params,
      );

      const [campaigns] = await pool.query(
        `SELECT ac.*,
                u.user_firstname, u.user_lastname, u.user_picture
         FROM ads_campaigns ac
         LEFT JOIN users u ON u.user_id = ac.campaign_user_id
         ${where}
         ORDER BY ac.campaign_created_date DESC
         LIMIT ? OFFSET ?`,
        [...params, parseInt(limit), offset],
      );

      return res.json({
        success: true,
        campaigns,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (err) {
      return AdsController._handleError(res, err);
    }
  }

  /**
   * GET /ads/my
   * Authenticated user's own campaigns.
   * Query params: page, limit, status (active|pending|declined|paused)
   */
  static async getMyCampaigns(req, res) {
    try {
      const userId = AdsController.getCurrentUserId(req);
      if (!userId) throw new UnauthorizedAdsError();

      const { page = 1, limit = 20, status } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const conditions = [`ac.campaign_user_id = ?`];
      const params = [userId];

      if (status === "active") {
        conditions.push(
          `ac.campaign_is_active = '1' AND ac.campaign_is_approved = '1'`,
        );
      } else if (status === "pending") {
        conditions.push(
          `ac.campaign_is_approved = '0' AND ac.campaign_is_declined = '0'`,
        );
      } else if (status === "declined") {
        conditions.push(`ac.campaign_is_declined = '1'`);
      } else if (status === "paused") {
        conditions.push(
          `ac.campaign_is_active = '0' AND ac.campaign_is_approved = '1'`,
        );
      }

      const where = `WHERE ${conditions.join(" AND ")}`;
      const [[{ total }]] = await pool.query(
        `SELECT COUNT(*) AS total FROM ads_campaigns ac ${where}`,
        params,
      );

      const [campaigns] = await pool.query(
        `SELECT ac.*,
                ROUND(ac.campaign_clicks / NULLIF(ac.campaign_views, 0) * 100, 2) AS ctr,
                ROUND(ac.campaign_budget - ac.campaign_spend, 2) AS budget_remaining
         FROM ads_campaigns ac
         ${where}
         ORDER BY ac.campaign_created_date DESC
         LIMIT ? OFFSET ?`,
        [...params, parseInt(limit), offset],
      );

      return res.json({
        success: true,
        campaigns,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (err) {
      return AdsController._handleError(res, err);
    }
  }

  /**
   * GET /ads/system
   * Returns admin-managed HTML/embed ads (ads_system table).
   * Query param: place
   */
  static async getSystemAds(req, res) {
    try {
      const { place } = req.query;
      const conditions = [];
      const params = [];

      if (place) {
        conditions.push(`place = ?`);
        params.push(place);
      }

      const where =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const [ads] = await pool.query(
        `SELECT * FROM ads_system ${where} ORDER BY time DESC`,
        params,
      );

      return res.json({ success: true, ads });
    } catch (err) {
      return AdsController._handleError(res, err);
    }
  }

  // ─────────────────────────────────────────────────────────
  //  SINGLE CAMPAIGN
  // ─────────────────────────────────────────────────────────

  /**
   * GET /ads/:campaignId
   */
  static async getCampaignById(req, res) {
    try {
      const { campaignId } = req.params;
      const userId = AdsController.getCurrentUserId(req);

      const [[campaign]] = await pool.query(
        `SELECT ac.*,
                u.user_firstname, u.user_lastname, u.user_picture
         FROM ads_campaigns ac
         LEFT JOIN users u ON u.user_id = ac.campaign_user_id
         WHERE ac.campaign_id = ?`,
        [campaignId],
      );

      if (!campaign) throw new AdsNotFoundError();

      // Non-owners can only view approved + active campaigns
      const isOwner = campaign.campaign_user_id === userId;
      if (
        !isOwner &&
        (campaign.campaign_is_approved !== "1" ||
          campaign.campaign_is_active !== "1")
      ) {
        throw new UnauthorizedAdsError("Campaign is not publicly visible");
      }

      campaign.ctr =
        campaign.campaign_views > 0
          ? (
              (campaign.campaign_clicks / campaign.campaign_views) *
              100
            ).toFixed(2)
          : "0.00";

      campaign.budget_remaining = (
        parseFloat(campaign.campaign_budget) -
        parseFloat(campaign.campaign_spend)
      ).toFixed(2);

      return res.json({ success: true, campaign });
    } catch (err) {
      return AdsController._handleError(res, err);
    }
  }

  // ─────────────────────────────────────────────────────────
  //  CREATE CAMPAIGN
  // ─────────────────────────────────────────────────────────

  /**
   * POST /ads
   * Creates a campaign. Deducts full budget from wallet immediately.
   * Accepts multipart/form-data (ads_image file) OR ads_image_base64 JSON.
   */
  static async createCampaign(req, res) {
    try {
      const userId = AdsController.getCurrentUserId(req);
      if (!userId) throw new UnauthorizedAdsError();

      const {
        campaign_title,
        campaign_start_date,
        campaign_end_date,
        campaign_budget,
        campaign_bidding,
        audience_countries,
        audience_gender,
        audience_relationship,
        ads_title,
        ads_description,
        ads_type,
        ads_url,
        ads_page,
        ads_group,
        ads_event,
        ads_placement,
      } = req.body;

      // ── Validation ───────────────────────────────────────────
      if (!campaign_title?.trim())
        throw new ValidationAdsError("Campaign title is required");
      if (!campaign_start_date)
        throw new ValidationAdsError("Start date is required");
      if (!campaign_end_date)
        throw new ValidationAdsError("End date is required");
      if (!campaign_budget || parseFloat(campaign_budget) <= 0)
        throw new ValidationAdsError("A valid budget amount is required");
      if (!["click", "view"].includes(campaign_bidding))
        throw new ValidationAdsError("Bidding must be 'click' or 'view'");
      if (!ads_type?.trim())
        throw new ValidationAdsError("Ad type is required");
      if (!["newsfeed", "sidebar"].includes(ads_placement))
        throw new ValidationAdsError(
          "Placement must be 'newsfeed' or 'sidebar'",
        );

      const start = new Date(campaign_start_date);
      const end = new Date(campaign_end_date);
      if (isNaN(start.getTime()) || isNaN(end.getTime()))
        throw new ValidationAdsError("Invalid date format");
      if (end <= start)
        throw new ValidationAdsError("End date must be after start date");

      const budget = parseFloat(campaign_budget);

      // ── Wallet balance check ─────────────────────────────────
      const { balance, sufficient } = await AdsController.checkWalletBalance(
        userId,
        budget,
      );
      if (!sufficient) {
        throw new InsufficientBalanceError(
          `Insufficient wallet balance. Required: $${budget.toFixed(
            2,
          )}, Available: $${balance.toFixed(2)}`,
        );
      }

      // ── Image upload ─────────────────────────────────────────
      let adsImagePath = "";

      if (req.files?.ads_image?.[0]) {
        const uploaded = await storageManager.upload(
          req.files.ads_image[0],
          "ads",
        );
        adsImagePath = uploaded?.url || uploaded?.path || String(uploaded);
      } else if (req.body.ads_image_base64) {
        const fname = `ad_${userId}_${Date.now()}`;
        const uploaded = await handleBase64Upload(
          req.body.ads_image_base64,
          fname,
          "ads",
        );
        adsImagePath = uploaded?.url || uploaded?.path || String(uploaded);
      } else {
        throw new ValidationAdsError("An ad image is required");
      }

      // ── Insert campaign ──────────────────────────────────────
      const [result] = await pool.query(
        `INSERT INTO ads_campaigns
           (campaign_user_id, campaign_title,
            campaign_start_date, campaign_end_date,
            campaign_budget, campaign_spend,
            campaign_bidding,
            audience_countries, audience_gender, audience_relationship,
            ads_title, ads_description,
            ads_type, ads_url,
            ads_page, ads_group, ads_event,
            ads_placement, ads_image,
            campaign_created_date,
            campaign_is_active, campaign_is_approved, campaign_is_declined,
            campaign_views, campaign_clicks)
   VALUES (?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),'1','1','0',0,0)`,
        [
          userId,
          campaign_title.trim(),
          campaign_start_date,
          campaign_end_date,
          budget,
          campaign_bidding,
          audience_countries || "",
          audience_gender || "all",
          audience_relationship || "all",
          ads_title || null,
          ads_description || null,
          ads_type,
          ads_url || null,
          ads_page ? parseInt(ads_page) : null,
          ads_group ? parseInt(ads_group) : null,
          ads_event ? parseInt(ads_event) : null,
          ads_placement,
          adsImagePath,
        ],
      );

      const campaignId = result.insertId;

      // ── Deduct wallet ────────────────────────────────────────
      await AdsController.deductWallet(userId, budget, campaignId);

      const [[campaign]] = await pool.query(
        `SELECT * FROM ads_campaigns WHERE campaign_id = ?`,
        [campaignId],
      );

      return res.status(201).json({
        success: true,
        message: "Campaign created. It will be reviewed before going live.",
        campaign,
      });
    } catch (err) {
      return AdsController._handleError(res, err);
    }
  }

  // ─────────────────────────────────────────────────────────
  //  UPDATE CAMPAIGN
  // ─────────────────────────────────────────────────────────

  /**
   * PUT /ads/:campaignId
   * Only the campaign owner can update. Re-sets to pending review.
   */
  static async updateCampaign(req, res) {
    try {
      const userId = AdsController.getCurrentUserId(req);
      if (!userId) throw new UnauthorizedAdsError();

      const { campaignId } = req.params;

      const [[campaign]] = await pool.query(
        `SELECT * FROM ads_campaigns WHERE campaign_id = ?`,
        [campaignId],
      );
      if (!campaign) throw new AdsNotFoundError();
      if (campaign.campaign_user_id !== userId)
        throw new UnauthorizedAdsError("You can only edit your own campaigns");

      const {
        campaign_title,
        campaign_start_date,
        campaign_end_date,
        campaign_bidding,
        audience_countries,
        audience_gender,
        audience_relationship,
        ads_title,
        ads_description,
        ads_type,
        ads_url,
        ads_page,
        ads_group,
        ads_event,
        ads_placement,
      } = req.body;

      // ── Image (optional update) ──────────────────────────────
      let adsImagePath = campaign.ads_image;
      if (req.files?.ads_image?.[0]) {
        const uploaded = await storageManager.upload(
          req.files.ads_image[0],
          "ads",
        );
        adsImagePath = uploaded?.url || uploaded?.path || String(uploaded);
      } else if (req.body.ads_image_base64) {
        const fname = `ad_${userId}_${Date.now()}`;
        const uploaded = await handleBase64Upload(
          req.body.ads_image_base64,
          fname,
          "ads",
        );
        adsImagePath = uploaded?.url || uploaded?.path || String(uploaded);
      }

      await pool.query(
        `UPDATE ads_campaigns SET
           campaign_title        = COALESCE(?, campaign_title),
           campaign_start_date   = COALESCE(?, campaign_start_date),
           campaign_end_date     = COALESCE(?, campaign_end_date),
           campaign_bidding      = COALESCE(?, campaign_bidding),
           audience_countries    = COALESCE(?, audience_countries),
           audience_gender       = COALESCE(?, audience_gender),
           audience_relationship = COALESCE(?, audience_relationship),
           ads_title             = COALESCE(?, ads_title),
           ads_description       = COALESCE(?, ads_description),
           ads_type              = COALESCE(?, ads_type),
           ads_url               = COALESCE(?, ads_url),
           ads_page              = COALESCE(?, ads_page),
           ads_group             = COALESCE(?, ads_group),
           ads_event             = COALESCE(?, ads_event),
           ads_placement         = COALESCE(?, ads_placement),
           ads_image             = ?,
           campaign_is_approved  = '0',
           campaign_is_declined  = '0'
         WHERE campaign_id = ?`,
        [
          campaign_title?.trim() || null,
          campaign_start_date || null,
          campaign_end_date || null,
          campaign_bidding || null,
          audience_countries || null,
          audience_gender || null,
          audience_relationship || null,
          ads_title || null,
          ads_description || null,
          ads_type || null,
          ads_url || null,
          ads_page ? parseInt(ads_page) : null,
          ads_group ? parseInt(ads_group) : null,
          ads_event ? parseInt(ads_event) : null,
          ads_placement || null,
          adsImagePath,
          campaignId,
        ],
      );

      const [[updated]] = await pool.query(
        `SELECT * FROM ads_campaigns WHERE campaign_id = ?`,
        [campaignId],
      );

      return res.json({
        success: true,
        message: "Campaign updated. Pending re-review.",
        campaign: updated,
      });
    } catch (err) {
      return AdsController._handleError(res, err);
    }
  }

  // ─────────────────────────────────────────────────────────
  //  DELETE CAMPAIGN
  // ─────────────────────────────────────────────────────────

  /**
   * DELETE /ads/:campaignId
   * Deactivates the campaign and refunds the unspent budget.
   */
  static async deleteCampaign(req, res) {
    try {
      const userId = AdsController.getCurrentUserId(req);
      if (!userId) throw new UnauthorizedAdsError();

      const { campaignId } = req.params;

      const [[campaign]] = await pool.query(
        `SELECT * FROM ads_campaigns WHERE campaign_id = ?`,
        [campaignId],
      );
      if (!campaign) throw new AdsNotFoundError();
      if (campaign.campaign_user_id !== userId)
        throw new UnauthorizedAdsError(
          "You can only delete your own campaigns",
        );

      const refund = Math.max(
        0,
        parseFloat(campaign.campaign_budget) -
          parseFloat(campaign.campaign_spend),
      );

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        await conn.query(
          `UPDATE ads_campaigns SET campaign_is_active = '0' WHERE campaign_id = ?`,
          [campaignId],
        );

        if (refund > 0) {
          await conn.query(
            `UPDATE users
             SET user_wallet_balance = user_wallet_balance + ?
             WHERE user_id = ?`,
            [refund, userId],
          );
          await conn.query(
            `INSERT INTO wallet_transactions
               (user_id, node_type, node_id, amount, type, description, date)
             VALUES (?, 'ads_campaign', ?, ?, 'in', 'Ad campaign unspent budget refund', NOW())`,
            [userId, campaignId, refund.toString()],
          );
        }

        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }

      return res.json({
        success: true,
        message: `Campaign deactivated.${
          refund > 0 ? ` $${refund.toFixed(2)} refunded to your wallet.` : ""
        }`,
        refund,
      });
    } catch (err) {
      return AdsController._handleError(res, err);
    }
  }

  // ─────────────────────────────────────────────────────────
  //  TOGGLE ACTIVE (pause / resume)
  // ─────────────────────────────────────────────────────────

  /**
   * PATCH /ads/:campaignId/toggle
   */
  static async toggleCampaign(req, res) {
    try {
      const userId = AdsController.getCurrentUserId(req);
      if (!userId) throw new UnauthorizedAdsError();

      const { campaignId } = req.params;

      const [[campaign]] = await pool.query(
        `SELECT * FROM ads_campaigns WHERE campaign_id = ?`,
        [campaignId],
      );
      if (!campaign) throw new AdsNotFoundError();
      if (campaign.campaign_user_id !== userId)
        throw new UnauthorizedAdsError();
      if (campaign.campaign_is_approved !== "1")
        throw new ValidationAdsError(
          "Cannot toggle a campaign that is not approved",
        );

      const newStatus = campaign.campaign_is_active === "1" ? "0" : "1";
      await pool.query(
        `UPDATE ads_campaigns SET campaign_is_active = ? WHERE campaign_id = ?`,
        [newStatus, campaignId],
      );

      return res.json({
        success: true,
        message: newStatus === "1" ? "Campaign resumed." : "Campaign paused.",
        campaign_is_active: newStatus,
      });
    } catch (err) {
      return AdsController._handleError(res, err);
    }
  }

  // ─────────────────────────────────────────────────────────
  //  RECORD VIEW
  // ─────────────────────────────────────────────────────────

  /**
   * POST /ads/:campaignId/view
   * Increments view counter; deducts CPM cost for view-bidding campaigns.
   */
  static async recordView(req, res) {
    try {
      const { campaignId } = req.params;

      const [[campaign]] = await pool.query(
        `SELECT * FROM ads_campaigns
         WHERE campaign_id = ? AND campaign_is_active = '1'`,
        [campaignId],
      );
      if (!campaign) return res.json({ success: true }); // silent ignore

      // CPM: cost = budget / (budget_views_estimate 1000)
      const costPerView =
        campaign.campaign_bidding === "view"
          ? parseFloat(campaign.campaign_budget) / 1000
          : 0;

      const newSpend = parseFloat(campaign.campaign_spend) + costPerView;

      await pool.query(
        `UPDATE ads_campaigns
         SET campaign_views = campaign_views + 1,
             campaign_spend = campaign_spend + ?
         WHERE campaign_id = ?`,
        [costPerView, campaignId],
      );

      await AdsController.pauseIfBudgetExhausted(
        campaignId,
        newSpend,
        campaign.campaign_budget,
      );

      return res.json({ success: true });
    } catch (err) {
      return AdsController._handleError(res, err);
    }
  }

  // ─────────────────────────────────────────────────────────
  //  RECORD CLICK
  // ─────────────────────────────────────────────────────────

  /**
   * POST /ads/:campaignId/click
   * Increments click counter; deducts CPC cost for click-bidding campaigns.
   */
  static async recordClick(req, res) {
    try {
      const { campaignId } = req.params;

      const [[campaign]] = await pool.query(
        `SELECT * FROM ads_campaigns
         WHERE campaign_id = ? AND campaign_is_active = '1'`,
        [campaignId],
      );
      if (!campaign) return res.json({ success: true, redirect_url: null });

      const costPerClick =
        campaign.campaign_bidding === "click"
          ? parseFloat(campaign.campaign_budget) / 500
          : 0;

      const newSpend = parseFloat(campaign.campaign_spend) + costPerClick;

      await pool.query(
        `UPDATE ads_campaigns
         SET campaign_clicks = campaign_clicks + 1,
             campaign_spend  = campaign_spend + ?
         WHERE campaign_id = ?`,
        [costPerClick, campaignId],
      );

      await AdsController.pauseIfBudgetExhausted(
        campaignId,
        newSpend,
        campaign.campaign_budget,
      );

      return res.json({ success: true, redirect_url: campaign.ads_url });
    } catch (err) {
      return AdsController._handleError(res, err);
    }
  }

  // ─────────────────────────────────────────────────────────
  //  CAMPAIGN STATS
  // ─────────────────────────────────────────────────────────

  /**
   * GET /ads/:campaignId/stats
   * Detailed performance stats for the campaign owner.
   */
  static async getCampaignStats(req, res) {
    try {
      const userId = AdsController.getCurrentUserId(req);
      if (!userId) throw new UnauthorizedAdsError();

      const { campaignId } = req.params;

      const [[campaign]] = await pool.query(
        `SELECT campaign_id, campaign_title, campaign_budget,
                campaign_spend, campaign_views, campaign_clicks,
                campaign_is_active, campaign_is_approved, campaign_is_declined,
                campaign_start_date, campaign_end_date, campaign_user_id
         FROM ads_campaigns WHERE campaign_id = ?`,
        [campaignId],
      );
      if (!campaign) throw new AdsNotFoundError();
      if (campaign.campaign_user_id !== userId)
        throw new UnauthorizedAdsError();

      const ctr =
        campaign.campaign_views > 0
          ? (
              (campaign.campaign_clicks / campaign.campaign_views) *
              100
            ).toFixed(2)
          : "0.00";

      const budgetRemaining = Math.max(
        0,
        parseFloat(campaign.campaign_budget) -
          parseFloat(campaign.campaign_spend),
      );

      const budgetUsedPct =
        campaign.campaign_budget > 0
          ? (
              (campaign.campaign_spend / campaign.campaign_budget) *
              100
            ).toFixed(1)
          : "0.0";

      return res.json({
        success: true,
        stats: {
          ...campaign,
          ctr,
          budget_remaining: budgetRemaining.toFixed(2),
          budget_used_pct: budgetUsedPct,
          cost_per_result:
            campaign.campaign_clicks > 0
              ? (
                  parseFloat(campaign.campaign_spend) / campaign.campaign_clicks
                ).toFixed(4)
              : "0.0000",
        },
      });
    } catch (err) {
      return AdsController._handleError(res, err);
    }
  }

  // ─────────────────────────────────────────────────────────
  //  ADMIN – APPROVE
  // ─────────────────────────────────────────────────────────

  /**
   * PATCH /ads/:campaignId/approve
   * Admin only. Sets campaign live.
   */
  static async approveCampaign(req, res) {
    try {
      const { campaignId } = req.params;

      const [[campaign]] = await pool.query(
        `SELECT * FROM ads_campaigns WHERE campaign_id = ?`,
        [campaignId],
      );
      if (!campaign) throw new AdsNotFoundError();

      await pool.query(
        `UPDATE ads_campaigns
         SET campaign_is_approved = '1',
             campaign_is_declined = '0',
             campaign_is_active   = '1'
         WHERE campaign_id = ?`,
        [campaignId],
      );

      return res.json({
        success: true,
        message: "Campaign approved and is now live.",
      });
    } catch (err) {
      return AdsController._handleError(res, err);
    }
  }

  // ─────────────────────────────────────────────────────────
  //  ADMIN – DECLINE
  // ─────────────────────────────────────────────────────────

  /**
   * PATCH /ads/:campaignId/decline
   * Admin only. Declines and refunds full budget.
   */
  static async declineCampaign(req, res) {
    try {
      const { campaignId } = req.params;
      const { reason } = req.body;

      const [[campaign]] = await pool.query(
        `SELECT * FROM ads_campaigns WHERE campaign_id = ?`,
        [campaignId],
      );
      if (!campaign) throw new AdsNotFoundError();

      await pool.query(
        `UPDATE ads_campaigns
         SET campaign_is_approved = '0',
             campaign_is_declined = '1',
             campaign_is_active   = '0'
         WHERE campaign_id = ?`,
        [campaignId],
      );

      // Refund the entire budget since it never ran (or remaining if it did)
      const refund = Math.max(
        0,
        parseFloat(campaign.campaign_budget) -
          parseFloat(campaign.campaign_spend),
      );

      if (refund > 0) {
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          await conn.query(
            `UPDATE users
             SET user_wallet_balance = user_wallet_balance + ?
             WHERE user_id = ?`,
            [refund, campaign.campaign_user_id],
          );
          await conn.query(
            `INSERT INTO wallet_transactions
               (user_id, node_type, node_id, amount, type, description, date)
             VALUES (?, 'ads_campaign', ?, ?, 'in', ?, NOW())`,
            [
              campaign.campaign_user_id,
              campaignId,
              refund.toString(),
              `Ad campaign declined${
                reason ? ` – ${reason}` : ""
              }. Budget refunded.`,
            ],
          );
          await conn.commit();
        } catch (err) {
          await conn.rollback();
          throw err;
        } finally {
          conn.release();
        }
      }

      return res.json({
        success: true,
        message: `Campaign declined.${
          refund > 0
            ? ` $${refund.toFixed(2)} refunded to the user's wallet.`
            : ""
        }`,
        refund,
      });
    } catch (err) {
      return AdsController._handleError(res, err);
    }
  }

  // ─────────────────────────────────────────────────────────
  //  SYSTEM ADS (admin HTML/embed ads)
  // ─────────────────────────────────────────────────────────

  /**
   * POST /ads/system
   */
  static async createSystemAd(req, res) {
    try {
      const { title, place, code, ads_pages_ids, ads_groups_ids } = req.body;

      if (!title?.trim()) throw new ValidationAdsError("Title is required");
      if (!place?.trim()) throw new ValidationAdsError("Place is required");
      if (!code?.trim()) throw new ValidationAdsError("Ad code is required");

      const [result] = await pool.query(
        `INSERT INTO ads_system (title, place, ads_pages_ids, ads_groups_ids, code, time)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [
          title.trim(),
          place.trim(),
          ads_pages_ids || null,
          ads_groups_ids || null,
          code,
        ],
      );

      return res.status(201).json({
        success: true,
        message: "System ad created.",
        ads_id: result.insertId,
      });
    } catch (err) {
      return AdsController._handleError(res, err);
    }
  }

  /**
   * PUT /ads/system/:adsId
   */
  static async updateSystemAd(req, res) {
    try {
      const { adsId } = req.params;
      const { title, place, code, ads_pages_ids, ads_groups_ids } = req.body;

      const [[ad]] = await pool.query(
        `SELECT * FROM ads_system WHERE ads_id = ?`,
        [adsId],
      );
      if (!ad) throw new AdsNotFoundError("System ad not found");

      await pool.query(
        `UPDATE ads_system SET
           title          = COALESCE(?, title),
           place          = COALESCE(?, place),
           code           = COALESCE(?, code),
           ads_pages_ids  = COALESCE(?, ads_pages_ids),
           ads_groups_ids = COALESCE(?, ads_groups_ids),
           time           = NOW()
         WHERE ads_id = ?`,
        [
          title?.trim() || null,
          place?.trim() || null,
          code || null,
          ads_pages_ids || null,
          ads_groups_ids || null,
          adsId,
        ],
      );

      return res.json({ success: true, message: "System ad updated." });
    } catch (err) {
      return AdsController._handleError(res, err);
    }
  }

  /**
   * DELETE /ads/system/:adsId
   */
  static async deleteSystemAd(req, res) {
    try {
      const { adsId } = req.params;

      const [[ad]] = await pool.query(
        `SELECT * FROM ads_system WHERE ads_id = ?`,
        [adsId],
      );
      if (!ad) throw new AdsNotFoundError("System ad not found");

      await pool.query(`DELETE FROM ads_system WHERE ads_id = ?`, [adsId]);

      return res.json({ success: true, message: "System ad deleted." });
    } catch (err) {
      return AdsController._handleError(res, err);
    }
  }

  // ─────────────────────────────────────────────────────────
  //  META – COUNTRIES (for audience targeting dropdowns)
  // ─────────────────────────────────────────────────────────

  /**
   * GET /ads/meta/countries
   */
  static async getCountries(req, res) {
    try {
      const [countries] = await pool.query(
        `SELECT country_id, country_name, country_code
         FROM system_countries
         WHERE enabled = '1'
         ORDER BY country_name ASC`,
      );
      return res.json({ success: true, countries });
    } catch (err) {
      return AdsController._handleError(res, err);
    }
  }

  // ─────────────────────────────────────────────────────────
  //  CENTRAL ERROR HANDLER
  // ─────────────────────────────────────────────────────────

  static _handleError(res, err) {
    console.error(`[AdsController] ${err.name || "Error"}: ${err.message}`);

    const knownErrors = [
      AdsNotFoundError,
      UnauthorizedAdsError,
      ValidationAdsError,
      InsufficientBalanceError,
    ];

    if (knownErrors.some((E) => err instanceof E)) {
      return res.status(err.statusCode).json({
        success: false,
        error: err.message,
        code: err.name,
      });
    }

    return res.status(500).json({
      success: false,
      error: "An unexpected server error occurred",
    });
  }
}

module.exports = AdsController;
