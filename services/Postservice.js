// services/postService.js
const pool = require("../config/db");
const storageManager = require("../utils/storageManager");
const PointsService = require("./pointsService");
const POINTS_CONFIG = require("../utils/pointsConfig");

class PostService {
  static async createPost({
    userId,
    userType = "user",
    text,
    privacy = "public",
    location,
    feeling_action,
    feeling_value,
    colored_pattern,
    postType = "text",
    files = {},
    link,
    inGroup = false,
    groupId = null,
    groupApproved = false,
    inEvent = false,
    eventId = null,
    eventApproved = false,
    inWall = false,
    wallId = null,
    isAnonymous = false,
    forAdult = false,
    disableComments = false,
    isPaid = false,
    postPrice = 0,
    paidText = null,
    forSubscriptions = false,
    tipsEnabled = false,
  }) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [postResult] = await connection.query(
        `INSERT INTO posts (
          user_id, user_type, post_type, text, privacy, location,
          feeling_action, feeling_value, colored_pattern, time,
          in_group, group_id, group_approved,
          in_event, event_id, event_approved,
          in_wall, wall_id,
          is_anonymous, for_adult, comments_disabled,
          is_paid, post_price, paid_text,
          for_subscriptions, tips_enabled,
          has_approved
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          userType,
          postType,
          text || null,
          privacy,
          location || null,
          feeling_action || null,
          feeling_value || null,
          colored_pattern || null,
          inGroup ? "1" : "0",
          groupId || null,
          groupApproved ? "1" : "0",
          inEvent ? "1" : "0",
          eventId || null,
          eventApproved ? "1" : "0",
          inWall ? "1" : "0",
          wallId || null,
          isAnonymous ? "1" : "0",
          forAdult ? "1" : "0",
          disableComments ? "1" : "0",
          isPaid ? "1" : "0",
          postPrice,
          paidText || null,
          forSubscriptions ? "1" : "0",
          tipsEnabled ? "1" : "0",
          "1",
        ],
      );

      const postId = postResult.insertId;

      const result = await this.handlePostType(
        connection,
        postId,
        postType,
        files,
        link,
        text,
      );

      await connection.commit();

      return {
        success: true,
        postId,
        postType,
        ...result,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // ==================== FEED POSTS ====================

  // ==================== FEED POSTS ====================

  static async getFeedPosts(
    viewerId,
    limit = 15,
    lastPostTime = null,
    lastPostId = null,
    filter = "all",
  ) {
    const connection = await pool.getConnection();

    try {
      const requestedLimit = Math.min(Math.max(Number(limit) || 15, 1), 50);
      const limitPlusOne = requestedLimit + 1;

      const blockCondition = `
      AND NOT EXISTS(
        SELECT 1 FROM users_blocks b
        WHERE (b.user_id = ? AND b.blocked_id = p.user_id)
           OR (b.user_id = p.user_id AND b.blocked_id = ?)
      )
    `;
      const blockParams = [viewerId, viewerId];

      let paginationCondition = "";
      let paginationParams = [];
      if (lastPostTime && lastPostId) {
        paginationCondition = `AND (p.time < ? OR (p.time = ? AND p.post_id < ?))`;
        paginationParams = [lastPostTime, lastPostTime, lastPostId];
      }

      const { conditions: filterCondition, params: filterParams } =
        this.buildFilterConditions(filter, viewerId);

      const query = `
      SELECT * FROM (
        SELECT
          p.post_id, p.user_id, p.user_type, p.post_type, p.text, p.time,
          p.privacy, p.views, p.comments, p.shares, p.boosted,
          p.in_group, p.group_id, p.in_event, p.event_id, p.origin_id,
          p.colored_pattern, p.is_paid, p.paid_text, p.location,
          p.feeling_action, p.feeling_value, p.for_adult, p.is_anonymous,
          p.tips_enabled, p.for_subscriptions,
          p.reaction_like_count, p.reaction_love_count, p.reaction_haha_count,
          p.reaction_yay_count, p.reaction_wow_count, p.reaction_sad_count,
          p.reaction_angry_count,

          cp.type AS pattern_type, cp.background_image,
          cp.background_color_1, cp.background_color_2, cp.text_color,

          pr.reaction AS user_reaction,

          COALESCE(u.user_firstname, pg.page_title) AS author_name,
          COALESCE(u.user_name, pg.page_name) AS author_username,
          COALESCE(u.user_picture, pg.page_picture) AS author_picture,
          COALESCE(u.user_verified, pg.page_verified) AS author_verified,
          CASE WHEN p.user_type = 'page' THEN pg.page_id ELSE u.user_id END AS author_id,
          p.user_type AS author_type,
          CASE 
            WHEN p.user_type = 'user' AND EXISTS(
              SELECT 1 FROM memberships 
              WHERE user_id = u.user_id AND status = 'active' AND expiry_date > NOW()
            ) THEN 1
            ELSE 0
          END AS author_has_active_membership,

          g.group_title, e.event_title,
          op.post_id AS shared_post_id, op.text AS shared_text,
          ou.user_firstname AS shared_user_name, ou.user_name AS shared_username, ou.user_picture AS shared_user_picture,

          EXISTS(SELECT 1 FROM posts_photos   WHERE post_id = p.post_id) AS has_photos,
          EXISTS(SELECT 1 FROM posts_videos   WHERE post_id = p.post_id) AS has_video,
          EXISTS(SELECT 1 FROM posts_audios   WHERE post_id = p.post_id) AS has_audio,
          EXISTS(SELECT 1 FROM posts_files    WHERE post_id = p.post_id) AS has_file,
          EXISTS(SELECT 1 FROM posts_links    WHERE post_id = p.post_id) AS has_link,
          EXISTS(SELECT 1 FROM posts_articles WHERE post_id = p.post_id) AS has_article,
          EXISTS(SELECT 1 FROM posts_products WHERE post_id = p.post_id) AS has_product,
          EXISTS(SELECT 1 FROM posts_jobs     WHERE post_id = p.post_id) AS has_job,
          EXISTS(SELECT 1 FROM posts_polls    WHERE post_id = p.post_id) AS has_poll,
          EXISTS(SELECT 1 FROM posts_funding  WHERE post_id = p.post_id) AS has_funding,
          EXISTS(SELECT 1 FROM posts_offers WHERE post_id = p.post_id) AS has_offer,

          EXISTS(SELECT 1 FROM posts_live     WHERE post_id = p.post_id AND live_ended = '0') AS has_live,
          (cp.pattern_id IS NOT NULL) AS has_colored_pattern

        FROM posts p
        LEFT JOIN users u ON p.user_type = 'user' AND u.user_id = p.user_id
        LEFT JOIN pages pg ON p.user_type = 'page' AND pg.page_id = p.user_id
        LEFT JOIN posts_reactions pr ON pr.post_id = p.post_id AND pr.user_id = ?
        LEFT JOIN posts_colored_patterns cp ON cp.pattern_id = p.colored_pattern
        LEFT JOIN \`groups\` g ON p.in_group = '1' AND g.group_id = p.group_id
        LEFT JOIN events e ON p.in_event = '1' AND e.event_id = p.event_id
        LEFT JOIN posts op ON op.post_id = p.origin_id
        LEFT JOIN users ou ON op.user_type = 'user' AND ou.user_id = op.user_id

        WHERE p.is_hidden = '0'
          AND p.in_wall = '0'
          AND p.has_approved = '1'
          ${blockCondition}
          ${filterCondition}
          ${paginationCondition}
      ) AS filtered_posts

      WHERE (
        privacy = 'public'
        OR (privacy = 'friends' AND user_type = 'user' AND in_group = '0'
          AND EXISTS(
            SELECT 1 FROM friends f
            WHERE (f.user_one_id = user_id AND f.user_two_id = ?)
               OR (f.user_one_id = ? AND f.user_two_id = user_id)
          )
        )
        OR user_id = ?
        OR (user_type = 'page' AND (
          EXISTS(SELECT 1 FROM pages_likes pl WHERE pl.page_id = user_id AND pl.user_id = ?)
          OR EXISTS(SELECT 1 FROM pages_admins pa WHERE pa.page_id = user_id AND pa.user_id = ?)
        ))
        OR (in_group = '1' AND EXISTS(
          SELECT 1 FROM groups_members gm
          WHERE gm.group_id = group_id AND gm.user_id = ? AND gm.approved = '1'
        ))
        OR (in_event = '1' AND EXISTS(
          SELECT 1 FROM events_members em
          WHERE em.event_id = event_id AND em.user_id = ?
            AND (em.is_going = '1' OR em.is_interested = '1' OR em.is_invited = '1')
        ))
      )
      ORDER BY boosted DESC, time DESC, post_id DESC
      LIMIT ?
    `;

      const params = [
        viewerId, // pr.reaction join
        ...blockParams,
        ...filterParams,
        ...paginationParams,
        viewerId,
        viewerId, // friends privacy
        viewerId, // own posts
        viewerId,
        viewerId, // page privacy
        viewerId, // group privacy
        viewerId, // event privacy
        limitPlusOne,
      ];

      const [rows] = await connection.query(query, params);

      const hasMore = rows.length > requestedLimit;
      const pageRows = hasMore ? rows.slice(0, requestedLimit) : rows;

      const postsWithDetails = await this.enrichPostsWithDetails(
        pageRows,
        viewerId,
        connection,
      );

      const last = pageRows[pageRows.length - 1] || null;

      return {
        data: postsWithDetails,
        has_more: hasMore,
        next_cursor:
          hasMore && last
            ? { last_post_time: last.time, last_post_id: last.post_id }
            : null,
      };
    } finally {
      connection.release();
    }
  }

  // ==================== USER POSTS ====================

  static async getUserPosts(userId, viewerId, limit = 20, offset = 0) {
    const connection = await pool.getConnection();

    try {
      const limitPlusOne = limit + 1;
      const privacyClause =
        viewerId === userId ? "" : `AND p.privacy = 'public'`;

      const [rows] = await connection.query(
        `SELECT
        p.post_id, p.user_id, p.user_type, p.post_type, p.text, p.time,
        p.privacy, p.views, p.comments, p.shares, p.boosted,
        p.in_group, p.group_id, p.in_event, p.event_id, p.origin_id,
        p.colored_pattern, p.is_paid, p.paid_text, p.location,
        p.feeling_action, p.feeling_value, p.for_adult, p.is_anonymous,
        p.tips_enabled, p.for_subscriptions,
        p.reaction_like_count, p.reaction_love_count, p.reaction_haha_count,
        p.reaction_yay_count, p.reaction_wow_count, p.reaction_sad_count,
        p.reaction_angry_count,

        cp.type AS pattern_type, cp.background_image,
        cp.background_color_1, cp.background_color_2, cp.text_color,

        pr.reaction AS user_reaction,

        u.user_firstname AS author_name, u.user_name AS author_username,
        u.user_picture AS author_picture, u.user_verified AS author_verified,
        u.user_id AS author_id, p.user_type AS author_type,

        NULL AS group_title, NULL AS event_title,
        op.post_id AS shared_post_id, op.text AS shared_text,
        ou.user_firstname AS shared_user_name, ou.user_name AS shared_username, ou.user_picture AS shared_user_picture,

        EXISTS(SELECT 1 FROM posts_photos   WHERE post_id = p.post_id) AS has_photos,
        EXISTS(SELECT 1 FROM posts_videos   WHERE post_id = p.post_id) AS has_video,
        EXISTS(SELECT 1 FROM posts_audios   WHERE post_id = p.post_id) AS has_audio,
        EXISTS(SELECT 1 FROM posts_files    WHERE post_id = p.post_id) AS has_file,
        EXISTS(SELECT 1 FROM posts_links    WHERE post_id = p.post_id) AS has_link,
        EXISTS(SELECT 1 FROM posts_articles WHERE post_id = p.post_id) AS has_article,
        EXISTS(SELECT 1 FROM posts_products WHERE post_id = p.post_id) AS has_product,
        EXISTS(SELECT 1 FROM posts_jobs     WHERE post_id = p.post_id) AS has_job,
        EXISTS(SELECT 1 FROM posts_polls    WHERE post_id = p.post_id) AS has_poll,
        EXISTS(SELECT 1 FROM posts_funding  WHERE post_id = p.post_id) AS has_funding,
        EXISTS(SELECT 1 FROM posts_live     WHERE post_id = p.post_id AND live_ended = '0') AS has_live,
        (cp.pattern_id IS NOT NULL) AS has_colored_pattern

       FROM posts p
       LEFT JOIN users u ON p.user_id = u.user_id
       LEFT JOIN posts_reactions pr ON pr.post_id = p.post_id AND pr.user_id = ?
       LEFT JOIN posts_colored_patterns cp ON cp.pattern_id = p.colored_pattern
       LEFT JOIN posts op ON op.post_id = p.origin_id
       LEFT JOIN users ou ON op.user_type = 'user' AND ou.user_id = op.user_id
       WHERE p.user_id = ? AND p.is_hidden = '0' AND p.post_type != 'share' ${privacyClause}
       ORDER BY p.time DESC
       LIMIT ? OFFSET ?`,
        [viewerId, userId, limitPlusOne, offset],
      );

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;

      const enriched = await this.enrichPostsWithDetails(
        pageRows,
        viewerId,
        connection,
      );

      const [[{ total }]] = await connection.query(
        `SELECT COUNT(*) as total FROM posts WHERE user_id = ? AND is_hidden = '0' AND post_type != 'share'`,
        [userId],
      );

      return { data: enriched, total_count: Number(total), has_more: hasMore };
    } finally {
      connection.release();
    }
  }

  // ==================== USER POST COUNT ====================

  static async getUserPostCount(userId) {
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM posts WHERE user_id = ? AND is_hidden = '0' AND privacy = 'public'`,
      [userId],
    );
    return Number(total);
  }

  // ==================== CATEGORIES ====================

  static async getCategories(type = "posts") {
    const startTime = Date.now();

    console.log("========== SERVICE: getCategories START ==========");
    console.log("Time:", new Date().toISOString());
    console.log("Incoming Type:", type);

    try {
      const tableMap = {
        blogs: "blogs_categories",
        jobs: "jobs_categories",
        market: "market_categories",
        events: "events_categories",
        groups: "groups_categories",
        pages: "pages_categories",
        videos: "posts_videos_categories",
      };

      console.log("Available Table Keys:", Object.keys(tableMap));

      const table = tableMap[type];

      console.log("Resolved Table:", table);

      if (!table) {
        console.warn("Invalid category type provided:", type);
        console.log("Returning empty array.");
        console.log(
          "========== SERVICE: getCategories END (INVALID TYPE) ==========",
        );
        return [];
      }

      const sql = `SELECT * FROM ${table} ORDER BY category_order ASC`;

      console.log("Executing SQL:", sql);

      const [categories] = await pool.query(sql);

      console.log("Query Successful.");
      console.log("Rows Returned:", categories?.length || 0);
      console.log("Raw DB Response:", categories);

      const duration = Date.now() - startTime;
      console.log("Execution Time:", `${duration}ms`);
      console.log("========== SERVICE: getCategories SUCCESS ==========");

      return categories;
    } catch (error) {
      const duration = Date.now() - startTime;

      console.error("========== SERVICE: getCategories ERROR ==========");
      console.error("Time:", new Date().toISOString());
      console.error("Execution Time:", `${duration}ms`);
      console.error("Error Name:", error.name);
      console.error("Error Message:", error.message);
      console.error("Error Code:", error.code);
      console.error("SQL State:", error.sqlState);
      console.error("Stack Trace:", error.stack);
      console.error("Full Error Object:", error);

      throw error;
    }
  }

  // ==================== RECORD POST VIEW ====================

  static async recordPostView(postId, viewerId = null, guestIp = null) {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      let checkQuery = `SELECT 1 FROM posts_views WHERE post_id = ? AND `;
      let checkParams = [postId];

      if (viewerId) {
        checkQuery += `user_id = ?`;
        checkParams.push(viewerId);
      } else if (guestIp) {
        checkQuery += `guest_ip = ?`;
        checkParams.push(guestIp);
      } else {
        throw new Error("Viewer ID or guest IP required");
      }

      const [existing] = await connection.query(checkQuery, checkParams);
      if (existing.length > 0) {
        await connection.commit();
        return false;
      }

      await connection.query(
        `UPDATE posts SET views = views + 1 WHERE post_id = ?`,
        [postId],
      );

      if (viewerId) {
        // ✅ Use PointsService for points allocation with daily limits and transaction logging
        await PointsService.addPoints(
          viewerId,
          POINTS_CONFIG.ACTIVITIES.POST_VIEWED,
          "post_view",
          postId,
          `Viewed post ${postId}`,
        );
      }

      await connection.query(
        `INSERT INTO posts_views (post_id, user_id, guest_ip, view_date) VALUES (?, ?, ?, NOW())`,
        [postId, viewerId || null, guestIp || null],
      );

      await connection.commit();
      return !!viewerId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // ==================== BATCH ENRICH POSTS WITH MEDIA ====================

  static async enrichPostsWithDetails(
    rows,
    viewerId,
    existingConnection = null,
  ) {
    if (!rows || rows.length === 0) return [];

    const postIds = rows.map((r) => r.post_id);
    const connection = existingConnection || (await pool.getConnection());
    const shouldRelease = !existingConnection;

    try {
      const needPhotos = rows.some((r) => Number(r.has_photos) === 1);
      const needVideos = rows.some((r) => Number(r.has_video) === 1);
      const needAudios = rows.some((r) => Number(r.has_audio) === 1);
      const needFiles = rows.some((r) => Number(r.has_file) === 1);
      const needLinks = rows.some((r) => Number(r.has_link) === 1);
      const needPolls = rows.some((r) => Number(r.has_poll) === 1);
      const needArticles = rows.some((r) => Number(r.has_article) === 1);
      const needProducts = rows.some((r) => Number(r.has_product) === 1);
      const needJobs = rows.some((r) => Number(r.has_job) === 1);
      const needFunding = rows.some((r) => Number(r.has_funding) === 1);
      const needLive = rows.some((r) => Number(r.has_live) === 1);
      const needOffers = rows.some((r) => Number(r.has_offer) === 1);

      let photosMap = new Map();
      let videosMap = new Map();
      let audiosMap = new Map();
      let filesMap = new Map();
      let linksMap = new Map();
      let pollsMap = new Map();
      let articlesMap = new Map();
      let productsMap = new Map();
      let jobsMap = new Map();
      let fundingMap = new Map();
      let liveMap = new Map();
      let offersMap = new Map();

      if (needPhotos) {
        const [photos] = await connection.query(
          `SELECT post_id, photo_id, source, blur FROM posts_photos WHERE post_id IN (?) ORDER BY photo_id ASC`,
          [postIds],
        );
        photos.forEach((p) => {
          if (!photosMap.has(p.post_id)) photosMap.set(p.post_id, []);
          photosMap.get(p.post_id).push(p);
        });
      }

      if (needVideos) {
        const [videos] = await connection.query(
          `SELECT post_id, video_id, source, thumbnail FROM posts_videos WHERE post_id IN (?)`,
          [postIds],
        );
        videos.forEach((v) => videosMap.set(v.post_id, v));
      }

      if (needOffers) {
        const [offers] = await connection.query(
          `SELECT * FROM posts_offers WHERE post_id IN (?)`,
          [postIds],
        );
        offers.forEach((o) => offersMap.set(o.post_id, o));
      }

      if (needAudios) {
        const [audios] = await connection.query(
          `SELECT post_id, audio_id, source FROM posts_audios WHERE post_id IN (?)`,
          [postIds],
        );
        audios.forEach((a) => audiosMap.set(a.post_id, a));
      }

      if (needFiles) {
        const [files] = await connection.query(
          `SELECT post_id, file_id, source FROM posts_files WHERE post_id IN (?)`,
          [postIds],
        );
        files.forEach((f) => filesMap.set(f.post_id, f));
      }

      if (needLinks) {
        const [links] = await connection.query(
          `SELECT post_id, link_id, source_url, source_title, source_thumbnail, source_text FROM posts_links WHERE post_id IN (?)`,
          [postIds],
        );
        links.forEach((l) => linksMap.set(l.post_id, l));
      }

      if (needPolls) {
        const [polls] = await connection.query(
          `SELECT poll_id, post_id, votes FROM posts_polls WHERE post_id IN (?)`,
          [postIds],
        );
        polls.forEach((p) => pollsMap.set(p.post_id, p));
      }

      if (needArticles) {
        const [articles] = await connection.query(
          `SELECT post_id, article_id, title, cover, text, category_id, tags FROM posts_articles WHERE post_id IN (?)`,
          [postIds],
        );
        articles.forEach((a) => {
          if (a.tags) {
            try {
              a.tags = JSON.parse(a.tags);
            } catch {
              a.tags = [];
            }
          }
          articlesMap.set(a.post_id, a);
        });
      }

      if (needProducts) {
        const [products] = await connection.query(
          `SELECT post_id, product_id, name, price, quantity, status, location FROM posts_products WHERE post_id IN (?)`,
          [postIds],
        );
        products.forEach((p) => productsMap.set(p.post_id, p));
      }

      if (needJobs) {
        const [jobs] = await connection.query(
          `SELECT post_id, job_id, title, location, salary_minimum, salary_maximum, pay_salary_per, type, cover_image FROM posts_jobs WHERE post_id IN (?)`,
          [postIds],
        );
        jobs.forEach((j) => jobsMap.set(j.post_id, j));
      }

      if (needFunding) {
        const [fundings] = await connection.query(
          `SELECT pf.post_id, pf.funding_id, pf.title, pf.amount, pf.cover_image,
          COALESCE(SUM(pfd.donation_amount), 0) as raised_amount,
          COUNT(DISTINCT pfd.donation_id) as donors_count
         FROM posts_funding pf
         LEFT JOIN posts_funding_donors pfd ON pf.post_id = pfd.post_id
         WHERE pf.post_id IN (?)
         GROUP BY pf.funding_id`,
          [postIds],
        );
        fundings.forEach((f) => fundingMap.set(f.post_id, f));
      }

      if (needLive) {
        const [live] = await connection.query(
          `SELECT post_id, live_id, video_thumbnail, live_ended FROM posts_live WHERE post_id IN (?)`,
          [postIds],
        );
        live.forEach((l) => liveMap.set(l.post_id, l));
      }

      return rows.map((row) =>
        this.formatPost(
          row,
          photosMap,
          videosMap,
          audiosMap,
          filesMap,
          linksMap,
          pollsMap,
          articlesMap,
          productsMap,
          jobsMap,
          fundingMap,
          liveMap,
          offersMap,
        ),
      );
    } finally {
      if (shouldRelease) connection.release();
    }
  }

  // ==================== FORMAT POST ====================

  // In PostService.js, update the formatPost method

  static formatPost(
    row,
    photosMap,
    videosMap,
    audiosMap,
    filesMap,
    linksMap,
    pollsMap,
    articlesMap,
    productsMap,
    jobsMap,
    fundingMap,
    liveMap,
    offersMap,
  ) {
    const photosArr = photosMap.get(row.post_id) || [];
    const videoRow = videosMap.get(row.post_id) || null;
    const audioRow = audiosMap.get(row.post_id) || null;
    const fileRow = filesMap.get(row.post_id) || null;
    const linkRow = linksMap.get(row.post_id) || null;
    const pollRow = pollsMap.get(row.post_id) || null;
    const articleRow = articlesMap.get(row.post_id) || null;
    const productRow = productsMap.get(row.post_id) || null;
    const jobRow = jobsMap.get(row.post_id) || null;
    const fundingRow = fundingMap.get(row.post_id) || null;
    const liveRow = liveMap.get(row.post_id) || null;
    const offerRow = offersMap.get(row.post_id) || null;

    const raisedAmount = parseFloat(fundingRow?.raised_amount) || 0;
    const goalAmount = parseFloat(fundingRow?.amount) || 0;

    // Determine if this post has an offer
    const hasOfferFromDB = Number(row.has_offer) === 1;
    const isOfferType = row.post_type === "offer";

    // If it's an offer type post but has no offer row, create a minimal offer from post data
    let offerData = offerRow;
    if (isOfferType && !offerData) {
      // Create a minimal offer from the post data
      offerData = {
        offer_id: null,
        title: row.text?.substring(0, 100) || "Special Offer",
        discount_type: "percent",
        discount_percent: 0,
        price: null,
        end_date: null,
        thumbnail: null,
      };
    }

    return {
      post_id: row.post_id,
      post_type: row.post_type,
      type: row.post_type,
      text: row.text || "",
      time: row.time,
      privacy: row.privacy,
      boosted: row.boosted === "1" || row.boosted === 1,
      is_paid: row.is_paid === "1" || row.is_paid === 1,
      paid_text: row.paid_text,
      location: row.location,
      feeling_action: row.feeling_action,
      feeling_value: row.feeling_value,
      for_adult: row.for_adult === "1" || row.for_adult === 1,
      is_anonymous: row.is_anonymous === "1" || row.is_anonymous === 1,
      tips_enabled: row.tips_enabled === "1" || row.tips_enabled === 1,
      for_subscriptions:
        row.for_subscriptions === "1" || row.for_subscriptions === 1,
      comments: Number(row.comments) || 0,
      shares: Number(row.shares) || 0,
      views: Number(row.views) || 0,

      author: {
        id: row.author_id,
        type: row.author_type,
        name: row.author_name || "User",
        username: row.author_username,
        picture: row.author_picture,
        verified: row.author_verified === "1" || row.author_verified === 1,
        has_active_membership:
          row.author_has_active_membership === 1 ||
          row.author_has_active_membership === "1",
      },

      // Return as array for parsePostFields compatibility
      reactions: [
        { reaction: "like", count: Number(row.reaction_like_count) || 0 },
        { reaction: "love", count: Number(row.reaction_love_count) || 0 },
        { reaction: "haha", count: Number(row.reaction_haha_count) || 0 },
        { reaction: "yay", count: Number(row.reaction_yay_count) || 0 },
        { reaction: "wow", count: Number(row.reaction_wow_count) || 0 },
        { reaction: "sad", count: Number(row.reaction_sad_count) || 0 },
        { reaction: "angry", count: Number(row.reaction_angry_count) || 0 },
      ].filter((r) => r.count > 0),
      reaction_like_count: Number(row.reaction_like_count) || 0,
      reaction_love_count: Number(row.reaction_love_count) || 0,
      reaction_haha_count: Number(row.reaction_haha_count) || 0,
      reaction_yay_count: Number(row.reaction_yay_count) || 0,
      reaction_wow_count: Number(row.reaction_wow_count) || 0,
      reaction_sad_count: Number(row.reaction_sad_count) || 0,
      reaction_angry_count: Number(row.reaction_angry_count) || 0,
      user_reaction: row.user_reaction || null,

      group: row.group_id ? { id: row.group_id, title: row.group_title } : null,
      event: row.event_id ? { id: row.event_id, title: row.event_title } : null,

      shared_post: row.shared_post_id
        ? {
            id: row.shared_post_id,
            text: row.shared_text,
            author: {
              name: row.shared_user_name,
              username: row.shared_username,
              picture: row.shared_user_picture,
            },
          }
        : null,

      has_photos: Number(row.has_photos) === 1,
      has_video: Number(row.has_video) === 1,
      has_audio: Number(row.has_audio) === 1,
      has_file: Number(row.has_file) === 1,
      has_link: Number(row.has_link) === 1,
      has_article: Number(row.has_article) === 1,
      has_product: Number(row.has_product) === 1,
      has_job: Number(row.has_job) === 1,
      has_poll: Number(row.has_poll) === 1,
      has_funding: Number(row.has_funding) === 1,
      has_live: Number(row.has_live) === 1,
      has_colored_pattern: Number(row.has_colored_pattern) === 1,

      photos: photosArr.map((p) => ({ ...p, source: p.source })),

      video: videoRow
        ? {
            id: videoRow.video_id,
            source: videoRow.source,
            thumbnail: videoRow.thumbnail,
          }
        : null,

      audio: audioRow
        ? {
            id: audioRow.audio_id,
            source: audioRow.source,
          }
        : null,

      file: fileRow
        ? {
            id: fileRow.file_id,
            source: fileRow.source,
          }
        : null,

      link: linkRow
        ? {
            id: linkRow.link_id,
            url: linkRow.source_url,
            title: linkRow.source_title,
            thumbnail: linkRow.source_thumbnail,
            description: linkRow.source_text,
          }
        : null,

      poll: pollRow
        ? {
            id: pollRow.poll_id,
            votes: Number(pollRow.votes) || 0,
          }
        : null,

      article: articleRow
        ? {
            id: articleRow.article_id,
            title: articleRow.title,
            cover: articleRow.cover,
            text: articleRow.text,
            tags: articleRow.tags,
          }
        : null,

      product: productRow
        ? {
            id: productRow.product_id,
            name: productRow.name,
            price: productRow.price,
            quantity: productRow.quantity,
            status: productRow.status,
            location: productRow.location,
          }
        : null,

      job: jobRow
        ? {
            id: jobRow.job_id,
            title: jobRow.title,
            location: jobRow.location,
            salary_minimum: jobRow.salary_minimum,
            salary_maximum: jobRow.salary_maximum,
            pay_salary_per: jobRow.pay_salary_per,
            type: jobRow.type,
            cover_image: jobRow.cover_image,
          }
        : null,

      funding: fundingRow
        ? {
            funding_id: fundingRow.funding_id,
            title: fundingRow.title,
            amount: goalAmount,
            raised_amount: raisedAmount,
            donors_count: parseInt(fundingRow.donors_count) || 0,
            cover_image: fundingRow.cover_image,
            percentage_funded:
              goalAmount > 0
                ? Math.min(100, Math.round((raisedAmount / goalAmount) * 100))
                : 0,
          }
        : null,

      live: liveRow
        ? {
            id: liveRow.live_id,
            thumbnail: liveRow.video_thumbnail,
            ended: liveRow.live_ended === "1" || liveRow.live_ended === 1,
          }
        : null,

      // FIX: Set has_offer to true if it's an offer type post OR if it has an offer in DB
      has_offer: hasOfferFromDB || isOfferType,

      // FIX: Use offerData which might be from DB or a fallback for offer type posts
      offer: offerData,

      colored_pattern: row.colored_pattern
        ? {
            id: row.colored_pattern,
            type: row.pattern_type,
            background_image: row.background_image,
            background_color_1: row.background_color_1,
            background_color_2: row.background_color_2,
            text_color: row.text_color,
          }
        : null,
    };
  }

  // ==================== FILTER CONDITIONS (ported from PostModel) ====================

  static buildFilterConditions(filter, viewerId) {
    let conditions = "";
    let params = [];

    switch (String(filter || "all").toLowerCase()) {
      case "all":
        conditions = `
        AND (
          (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL AND u.user_firstname IS NOT NULL AND u.user_firstname != '')
          OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
        )
        AND (
          EXISTS(SELECT 1 FROM posts_photos WHERE post_id = p.post_id)
          OR EXISTS(SELECT 1 FROM posts_videos WHERE post_id = p.post_id)
          OR p.colored_pattern IS NOT NULL
          OR EXISTS(SELECT 1 FROM posts_live WHERE post_id = p.post_id AND live_ended = '0')
          OR EXISTS(SELECT 1 FROM posts_links WHERE post_id = p.post_id)
          OR p.text IS NOT NULL AND p.text != ''
        )`;
        break;
      case "friends":
        conditions = `
        AND p.in_group = '0' AND p.user_type = 'user'
        AND u.user_id IS NOT NULL AND u.user_firstname IS NOT NULL AND u.user_firstname != ''
        AND EXISTS(
          SELECT 1 FROM friends f
          WHERE (f.user_one_id = p.user_id AND f.user_two_id = ?)
             OR (f.user_one_id = ? AND f.user_two_id = p.user_id)
        )`;
        params = [viewerId, viewerId];
        break;
      case "photos":
        conditions = `AND EXISTS(SELECT 1 FROM posts_photos WHERE post_id = p.post_id)
        AND ((p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL) OR (p.user_type = 'page' AND pg.page_id IS NOT NULL))`;
        break;
      case "videos":
        conditions = `AND EXISTS(SELECT 1 FROM posts_videos WHERE post_id = p.post_id)
        AND ((p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL) OR (p.user_type = 'page' AND pg.page_id IS NOT NULL))`;
        break;
      case "audio":
        conditions = `AND EXISTS(SELECT 1 FROM posts_audios WHERE post_id = p.post_id)
        AND ((p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL) OR (p.user_type = 'page' AND pg.page_id IS NOT NULL))`;
        break;
      case "articles":
        conditions = `AND EXISTS(SELECT 1 FROM posts_articles WHERE post_id = p.post_id)
        AND ((p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL) OR (p.user_type = 'page' AND pg.page_id IS NOT NULL))`;
        break;
      case "products":
        conditions = `AND EXISTS(SELECT 1 FROM posts_products WHERE post_id = p.post_id)
        AND ((p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL) OR (p.user_type = 'page' AND pg.page_id IS NOT NULL))`;
        break;
      case "jobs":
        conditions = `AND EXISTS(SELECT 1 FROM posts_jobs WHERE post_id = p.post_id)
        AND ((p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL) OR (p.user_type = 'page' AND pg.page_id IS NOT NULL))`;
        break;
      case "polls":
        conditions = `AND EXISTS(SELECT 1 FROM posts_polls WHERE post_id = p.post_id)
        AND ((p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL) OR (p.user_type = 'page' AND pg.page_id IS NOT NULL))`;
        break;
      case "colored":
        conditions = `AND EXISTS(SELECT 1 FROM posts_colored_patterns cp WHERE cp.pattern_id = p.colored_pattern)
        AND ((p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL) OR (p.user_type = 'page' AND pg.page_id IS NOT NULL))`;
        break;
      case "live":
        conditions = `AND EXISTS(SELECT 1 FROM posts_live WHERE post_id = p.post_id AND live_ended = '0')`;
        break;
      case "links":
        conditions = `AND EXISTS(SELECT 1 FROM posts_links WHERE post_id = p.post_id)
        AND ((p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL) OR (p.user_type = 'page' AND pg.page_id IS NOT NULL))`;
        break;
      case "offers":
        conditions = `AND EXISTS(SELECT 1 FROM posts_offers WHERE post_id = p.post_id)
      AND ((p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL) OR (p.user_type = 'page' AND pg.page_id IS NOT NULL))`;
        break;
      default:
        conditions = `
        AND ((p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL AND u.user_firstname IS NOT NULL AND u.user_firstname != '')
          OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
          OR (p.in_group = '1'))`;
        break;
    }

    return { conditions, params };
  }

  static async handlePostType(connection, postId, postType, files, link, text) {
    let result = {};

    switch (postType) {
      case "photo":
      case "photos":
        if (files.photos) {
          result.photoIds = await this.handlePhotos(
            connection,
            postId,
            files.photos,
          );
        }
        break;

      case "video":
        if (files.videos) {
          result.videoIds = await this.handleVideos(
            connection,
            postId,
            files.videos,
          );
        }
        break;

      case "file":
        if (files.files) {
          result.fileIds = await this.handleFiles(
            connection,
            postId,
            files.files,
          );
        }
        break;

      case "link":
        if (link) {
          result.linkId = await this.handleLink(connection, postId, link);
        }
        break;

      case "article":
        if (files.articleData) {
          result.articleId = await this.handleArticle(
            connection,
            postId,
            files.articleData,
            files.cover,
          );
        }
        break;

      case "poll":
        if (files.pollData) {
          result.pollId = await this.handlePoll(
            connection,
            postId,
            files.pollData,
          );
        }
        break;

      case "job":
        if (files.jobData) {
          result.jobId = await this.handleJob(
            connection,
            postId,
            files.jobData,
            files.coverImage,
          );
        }
        break;

      case "product":
        if (files.productData) {
          result.productId = await this.handleProduct(
            connection,
            postId,
            files.productData,
            files.productImages,
          );
        }
        break;

      case "funding":
        if (files.fundingData) {
          result.fundingId = await this.handleFunding(
            connection,
            postId,
            files.fundingData,
            files.coverImage,
          );
        }
        break;

      case "live":
        const liveResult = await this.handleLive(
          connection,
          postId,
          files.liveData || {},
          files.thumbnail || [],
        );
        result.liveId = liveResult.liveId;
        result.agoraData = liveResult.agoraData;
        break;

      case "audio":
        if (files.audio) {
          result.audioId = await this.handleAudio(
            connection,
            postId,
            files.audio,
          );
        }
        break;
      case "offer":
        if (files.offerData) {
          result.offerId = await this.handleOffer(
            connection,
            postId,
            files.offerData,
            files.thumbnail,
          );
        }
        break;

      case "media":
        if (files.media) {
          result.mediaId = await this.handleMedia(
            connection,
            postId,
            files.media,
          );
        }
        break;

      default:
        if (!text && postType === "text") {
          throw new Error("Text posts must contain some text");
        }
    }

    return result;
  }

  static async handlePhotos(connection, postId, photos) {
    const photoIds = [];
    for (const photoFile of photos) {
      photoFile.originalname = `post-photo-${Date.now()}-${photoFile.originalname}`;
      const photoData = await storageManager.upload(photoFile, "post-photos");
      const [result] = await connection.query(
        "INSERT INTO posts_photos (post_id, source) VALUES (?, ?)",
        [postId, photoData.path],
      );
      photoIds.push(result.insertId);
    }
    return photoIds;
  }

  static async handleVideos(connection, postId, videos) {
    const videoIds = [];
    for (const videoFile of videos) {
      videoFile.originalname = `post-video-${Date.now()}-${videoFile.originalname}`;
      const videoData = await storageManager.upload(videoFile, "post-videos");
      const [result] = await connection.query(
        "INSERT INTO posts_videos (post_id, source, thumbnail) VALUES (?, ?, ?)",
        [postId, videoData.path, videoData.thumbnail || null],
      );
      videoIds.push(result.insertId);
    }
    return videoIds;
  }

  static async handleFiles(connection, postId, files) {
    const fileIds = [];
    for (const file of files) {
      file.originalname = `post-file-${Date.now()}-${file.originalname}`;
      const fileData = await storageManager.upload(file, "post-files");
      const [result] = await connection.query(
        "INSERT INTO posts_files (post_id, source) VALUES (?, ?)",
        [postId, fileData.path],
      );
      fileIds.push(result.insertId);
    }
    return fileIds;
  }

  static async handleLink(connection, postId, link) {
    try {
      const url = new URL(link);
      const linkData = {
        url: link,
        hostname: url.hostname,
        title: url.hostname.replace("www.", ""),
      };
      const [result] = await connection.query(
        `INSERT INTO posts_links (post_id, source_url, source_host, source_title) VALUES (?, ?, ?, ?)`,
        [postId, linkData.url, linkData.hostname, linkData.title],
      );
      return result.insertId;
    } catch (error) {
      throw new Error("Invalid URL provided");
    }
  }

  static async handleArticle(connection, postId, articleData, cover) {
    let coverPath = null;
    if (cover && cover[0]) {
      const coverFile = cover[0];
      coverFile.originalname = `article-cover-${Date.now()}-${coverFile.originalname}`;
      const coverData = await storageManager.upload(
        coverFile,
        "article-covers",
      );
      coverPath = coverData.path;
    }

    const [result] = await connection.query(
      `INSERT INTO posts_articles (post_id, cover, title, text, category_id, tags) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        postId,
        coverPath,
        articleData.title,
        articleData.text,
        articleData.category_id || null,
        articleData.tags ? JSON.stringify(articleData.tags) : null,
      ],
    );
    return result.insertId;
  }

  static async handlePoll(connection, postId, pollData) {
    const [pollResult] = await connection.query(
      "INSERT INTO posts_polls (post_id) VALUES (?)",
      [postId],
    );
    const pollId = pollResult.insertId;

    if (pollData.options && Array.isArray(pollData.options)) {
      for (const optionText of pollData.options) {
        if (optionText.trim()) {
          await connection.query(
            "INSERT INTO posts_polls_options (poll_id, text) VALUES (?, ?)",
            [pollId, optionText.trim()],
          );
        }
      }
    }
    return pollId;
  }

  static async handleJob(connection, postId, jobData, coverImage) {
    let coverImagePath = null;
    if (coverImage && coverImage[0]) {
      const coverFile = coverImage[0];
      coverFile.originalname = `job-cover-${Date.now()}-${coverFile.originalname}`;
      const coverData = await storageManager.upload(coverFile, "job-covers");
      coverImagePath = coverData.path;
    }

    const [result] = await connection.query(
      `INSERT INTO posts_jobs 
       (post_id, category_id, title, location, salary_minimum, salary_maximum, 
        pay_salary_per, type, cover_image, available) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        postId,
        jobData.category_id || null,
        jobData.title,
        jobData.location || "",
        jobData.salary_minimum || 0,
        jobData.salary_maximum || 0,
        jobData.pay_salary_per || "month",
        jobData.type || "full_time",
        coverImagePath,
        jobData.available !== false ? "1" : "0",
      ],
    );
    return result.insertId;
  }

  static async handleProduct(connection, postId, productData, productImages) {
    const [productResult] = await connection.query(
      `INSERT INTO posts_products 
       (post_id, name, price, quantity, category_id, status, location, 
        available, is_digital, product_download_url) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        postId,
        productData.name,
        productData.price || 0,
        productData.quantity || 1,
        productData.category_id || null,
        productData.status || "new",
        productData.location || "",
        productData.available !== false ? "1" : "0",
        productData.is_digital ? "1" : "0",
        productData.product_download_url || null,
      ],
    );
    const productId = productResult.insertId;

    if (productImages && productImages.length > 0) {
      for (const imageFile of productImages) {
        imageFile.originalname = `product-${Date.now()}-${imageFile.originalname}`;
        const imageData = await storageManager.upload(
          imageFile,
          "product-images",
        );
        await connection.query(
          "INSERT INTO posts_photos (post_id, source) VALUES (?, ?)",
          [postId, imageData.path],
        );
      }
    }
    return productId;
  }

  static async handleFunding(connection, postId, fundingData, coverImage) {
    let coverImagePath = null;
    if (coverImage && coverImage[0]) {
      const coverFile = coverImage[0];
      coverFile.originalname = `funding-cover-${Date.now()}-${coverFile.originalname}`;
      const coverData = await storageManager.upload(
        coverFile,
        "funding-covers",
      );
      coverImagePath = coverData.path;
    }

    const [result] = await connection.query(
      `INSERT INTO posts_funding (post_id, title, amount, cover_image) VALUES (?, ?, ?, ?)`,
      [postId, fundingData.title, fundingData.amount || 0, coverImagePath],
    );
    return result.insertId;
  }

  static async handleLive(connection, postId, liveData, thumbnailFile) {
    let thumbnailPath = null;

    if (thumbnailFile && thumbnailFile[0]) {
      const thumbFile = thumbnailFile[0];
      try {
        const thumbnailData = await storageManager.upload(
          thumbFile,
          "live-thumbnails",
        );
        thumbnailPath = thumbnailData.path;
      } catch (uploadError) {
        console.error("Failed to upload thumbnail:", uploadError);
        throw new Error("Failed to upload live thumbnail");
      }
    }

    if (!thumbnailPath) {
      thumbnailPath = "defaults/live-thumbnail.jpg";
    }

    const agoraData = {
      agora_uid: Math.floor(Math.random() * 1000000),
      agora_channel_name: `live_${postId}_${Date.now()}`,
    };

    const [result] = await connection.query(
      `INSERT INTO posts_live (post_id, video_thumbnail, agora_uid, agora_channel_name) VALUES (?, ?, ?, ?)`,
      [
        postId,
        thumbnailPath,
        agoraData.agora_uid,
        agoraData.agora_channel_name,
      ],
    );

    return { liveId: result.insertId, agoraData };
  }

  static async handleAudio(connection, postId, audio) {
    const audioFile = audio[0];
    audioFile.originalname = `post-audio-${Date.now()}-${audioFile.originalname}`;
    const audioData = await storageManager.upload(audioFile, "post-audios");
    const [result] = await connection.query(
      "INSERT INTO posts_audios (post_id, source) VALUES (?, ?)",
      [postId, audioData.path],
    );
    return result.insertId;
  }

  static async handleMedia(connection, postId, mediaData) {
    const [result] = await connection.query(
      `INSERT INTO posts_media (post_id, source_url, source_provider, source_type, source_title) VALUES (?, ?, ?, ?, ?)`,
      [
        postId,
        mediaData.source_url,
        mediaData.source_provider || "unknown",
        mediaData.source_type || "video",
        mediaData.source_title || null,
      ],
    );
    return result.insertId;
  }

  // ==================== GET POST BY ID (FULLY ENRICHED) ====================

  static async getPostById(postId, currentUserId = null) {
    try {
      const [posts] = await pool.query(
        `SELECT p.*, 
          u.user_name, u.user_firstname, u.user_lastname, u.user_picture, u.user_verified,
          pg.page_id AS page_id, pg.page_name, pg.page_title, pg.page_picture, pg.page_verified,
          g.group_id AS group_id, g.group_name, g.group_title, g.group_picture,
          e.event_id AS event_id, e.event_title, e.event_cover,
          COUNT(DISTINCT pr.id) AS reactions_count,
          COUNT(DISTINCT pc.comment_id) AS comments_count,
          COUNT(DISTINCT ps.post_id) AS shares_count,
          pp.pattern_id AS colored_pattern_id,
          pp.type AS pattern_type,
          pp.background_image,
          pp.background_color_1,
          pp.background_color_2,
          pp.text_color,
          op.post_id AS shared_post_id, op.text AS shared_text,
          ou.user_firstname AS shared_user_name, ou.user_name AS shared_username, ou.user_picture AS shared_user_picture
         FROM posts p
         LEFT JOIN users u ON p.user_id = u.user_id AND p.user_type = 'user'
         LEFT JOIN pages pg ON p.user_id = pg.page_id AND p.user_type = 'page'
         LEFT JOIN \`groups\` g ON p.group_id = g.group_id AND p.in_group = '1'
         LEFT JOIN events e ON p.event_id = e.event_id AND p.in_event = '1'
         LEFT JOIN posts_reactions pr ON p.post_id = pr.post_id
         LEFT JOIN posts_comments pc ON p.post_id = pc.node_id AND pc.node_type = 'post'
         LEFT JOIN posts ps ON ps.origin_id = p.post_id
         LEFT JOIN posts_colored_patterns pp ON p.colored_pattern = pp.pattern_id
         LEFT JOIN posts op ON op.post_id = p.origin_id
         LEFT JOIN users ou ON op.user_type = 'user' AND ou.user_id = op.user_id
         WHERE p.post_id = ?
         GROUP BY p.post_id`,
        [postId],
      );

      if (posts.length === 0) return null;

      const post = posts[0];

      await this.enrichPostData(post, postId, currentUserId);

      // Format colored pattern data properly
      if (post.colored_pattern) {
        post.colored_pattern = {
          id: post.colored_pattern_id,
          type: post.pattern_type,
          background_image: post.background_image,
          background_color_1: post.background_color_1,
          background_color_2: post.background_color_2,
          text_color: post.text_color,
        };
      }

      return post;
    } catch (error) {
      console.error("Error in getPostById:", error);
      throw error;
    }
  }

  static async enrichPostData(post, postId, currentUserId) {
    switch (post.post_type) {
      case "photo":
      case "photos":
        await this.enrichPhotoPost(post, postId);
        break;
      case "video":
        await this.enrichVideoPost(post, postId);
        break;
      case "file":
        await this.enrichFilePost(post, postId);
        break;
      case "link":
        await this.enrichLinkPost(post, postId);
        break;
      case "article":
        await this.enrichArticlePost(post, postId);
        break;
      case "poll":
        await this.enrichPollPost(post, postId, currentUserId);
        break;
      case "job":
        await this.enrichJobPost(post, postId);
        break;
      case "product":
        await this.enrichProductPost(post, postId);
        break;
      case "funding":
        await this.enrichFundingPost(post, postId);
        break;
      case "live":
        await this.enrichLivePost(post, postId);
        break;
      case "audio":
        await this.enrichAudioPost(post, postId);
        break;
      case "media":
        await this.enrichMediaPost(post, postId);
        break;
      case "profile_picture":
        await this.enrichProfilePicturePost(post, postId);
        break;
      case "profile_cover":
        await this.enrichProfileCoverPost(post, postId);
        break;
    }

    await this.enrichReactionCounts(post, postId);
    await this.enrichComments(post, postId, currentUserId);
    await this.enrichShares(post, postId);
    await this.enrichHashtags(post, postId);

    if (currentUserId) {
      await this.enrichUserReaction(post, postId, currentUserId);
      await this.enrichUserSaved(post, postId, currentUserId);
      await this.enrichUserShared(post, postId, currentUserId);
    }
  }

  static async enrichPhotoPost(post, postId) {
    const [photos] = await pool.query(
      `SELECT pp.*, 
        COUNT(DISTINCT ppr.id) as reactions_count,
        COUNT(DISTINCT pcr.comment_id) as comments_count
       FROM posts_photos pp
       LEFT JOIN posts_photos_reactions ppr ON pp.photo_id = ppr.photo_id
       LEFT JOIN posts_comments pcr ON pp.photo_id = pcr.node_id AND pcr.node_type = 'photo'
       WHERE pp.post_id = ?
       GROUP BY pp.photo_id
       ORDER BY pp.photo_id ASC`,
      [postId],
    );
    post.photos = photos;
  }

  static async enrichVideoPost(post, postId) {
    const [videos] = await pool.query(
      `SELECT pv.*, COUNT(DISTINCT pvr.view_id) as views_count
    FROM posts_videos pv
    LEFT JOIN posts_views pvr ON pv.video_id = pvr.post_id
    WHERE pv.post_id = ?
    GROUP BY pv.video_id`,
      [postId],
    );
    post.videos = videos;
    post.video = videos[0] || null;
  }

  static async enrichFilePost(post, postId) {
    const [files] = await pool.query(
      "SELECT * FROM posts_files WHERE post_id = ? ORDER BY file_id ASC",
      [postId],
    );
    post.files = files;
  }

  static async enrichLinkPost(post, postId) {
    const [links] = await pool.query(
      "SELECT * FROM posts_links WHERE post_id = ?",
      [postId],
    );
    post.link = links[0] || null;
  }

  static async enrichArticlePost(post, postId) {
    const [articles] = await pool.query(
      `SELECT pa.*, bc.category_name as blog_category_name
       FROM posts_articles pa
       LEFT JOIN blogs_categories bc ON pa.category_id = bc.category_id
       WHERE pa.post_id = ?`,
      [postId],
    );

    if (articles[0]) {
      post.article = articles[0];
      if (post.article.tags) {
        try {
          post.article.tags = JSON.parse(post.article.tags);
        } catch {
          post.article.tags = [];
        }
      }
    }
  }

  static async enrichPollPost(post, postId, currentUserId) {
    // Get the poll
    const [polls] = await pool.query(
      `SELECT pp.*,
        COUNT(DISTINCT ppo.option_id) as options_count,
        COUNT(DISTINCT ppou.id) as votes_count
       FROM posts_polls pp
       LEFT JOIN posts_polls_options ppo ON pp.poll_id = ppo.poll_id
       LEFT JOIN posts_polls_options_users ppou ON ppo.option_id = ppou.option_id
       WHERE pp.post_id = ?
       GROUP BY pp.poll_id`,
      [postId],
    );

    if (!polls[0]) return;

    post.poll = polls[0];

    // Get options with vote counts and percentages
    const totalVotes = post.poll.votes_count || 0;
    const [options] = await pool.query(
      `SELECT ppo.*,
        COUNT(DISTINCT ppou.id) as votes_count,
        ROUND((COUNT(DISTINCT ppou.id) * 100.0 / NULLIF(?, 0)), 1) as percentage
       FROM posts_polls_options ppo
       LEFT JOIN posts_polls_options_users ppou ON ppo.option_id = ppou.option_id
       WHERE ppo.poll_id = ?
       GROUP BY ppo.option_id
       ORDER BY ppo.option_id ASC`,
      [totalVotes, post.poll.poll_id],
    );

    post.poll.options = options;
    post.poll.user_voted = false;
    post.poll.user_vote_option = null;

    // Check if current user has voted
    if (currentUserId) {
      const [userVote] = await pool.query(
        `SELECT ppou.option_id
         FROM posts_polls_options_users ppou
         JOIN posts_polls_options ppo ON ppou.option_id = ppo.option_id
         WHERE ppou.user_id = ? AND ppo.poll_id = ?`,
        [currentUserId, post.poll.poll_id],
      );

      if (userVote.length > 0) {
        post.poll.user_voted = true;
        post.poll.user_vote_option = userVote[0].option_id;
      }
    }
  }

  static async enrichJobPost(post, postId) {
    const [jobs] = await pool.query(
      `SELECT pj.*, jc.category_name as job_category_name
       FROM posts_jobs pj
       LEFT JOIN jobs_categories jc ON pj.category_id = jc.category_id
       WHERE pj.post_id = ?`,
      [postId],
    );
    post.job = jobs[0] || null;
  }

  static async enrichProductPost(post, postId) {
    const [products] = await pool.query(
      `SELECT pp.*, mc.category_name as market_category_name
       FROM posts_products pp
       LEFT JOIN market_categories mc ON pp.category_id = mc.category_id
       WHERE pp.post_id = ?`,
      [postId],
    );

    if (products[0]) {
      post.product = products[0];
      const [images] = await pool.query(
        "SELECT photo_id, source FROM posts_photos WHERE post_id = ? ORDER BY photo_id ASC",
        [postId],
      );
      post.product.images = images;
    }
  }

  static async enrichFundingPost(post, postId) {
    const [fundings] = await pool.query(
      `SELECT 
      pf.*,
      COUNT(DISTINCT pfd.donation_id) as donors_count,
      COALESCE(SUM(pfd.donation_amount), 0) as raised_amount,
      CASE 
        WHEN pf.amount > 0 
        THEN ROUND((COALESCE(SUM(pfd.donation_amount), 0) * 100.0 / pf.amount), 1)
        ELSE 0 
      END as percentage_funded
     FROM posts_funding pf
     LEFT JOIN posts_funding_donors pfd ON pf.post_id = pfd.post_id
     WHERE pf.post_id = ?
     GROUP BY pf.funding_id`,
      [postId],
    );

    if (fundings[0]) {
      // Ensure raised_amount is properly parsed as a number
      const raised_amount = parseFloat(fundings[0].raised_amount) || 0;
      const amount = parseFloat(fundings[0].amount) || 0;

      post.funding = {
        funding_id: fundings[0].funding_id,
        post_id: fundings[0].post_id,
        title: fundings[0].title,
        description: fundings[0].description,
        cover_image: fundings[0].cover_image,
        amount: amount,
        raised_amount: raised_amount,
        percentage_funded: parseFloat(fundings[0].percentage_funded) || 0,
        donors_count: parseInt(fundings[0].donors_count) || 0,
      };

      // Get recent donors with properly parsed amounts
      const [donors] = await pool.query(
        `SELECT 
        pfd.donation_id,
        pfd.user_id,
        pfd.donation_amount,
        pfd.donation_time,
        u.user_name,
        u.user_firstname,
        u.user_lastname,
        u.user_picture
       FROM posts_funding_donors pfd
       LEFT JOIN users u ON pfd.user_id = u.user_id
       WHERE pfd.post_id = ?
       ORDER BY pfd.donation_time DESC
       LIMIT 10`,
        [postId],
      );

      post.funding.recent_donors = donors.map((donor) => ({
        donation_id: donor.donation_id,
        user_id: donor.user_id,
        name: donor.user_name || donor.user_firstname || "User",
        firstname: donor.user_firstname,
        lastname: donor.user_lastname,
        picture: donor.user_picture,
        amount: parseFloat(donor.donation_amount) || 0,
        time: donor.donation_time,
        time_formatted: donor.donation_time,
        message: donor.message || null,
        is_anonymous: donor.is_anonymous === 1 || donor.is_anonymous === "1",
      }));
    }
  }

  static async enrichLivePost(post, postId) {
    const [lives] = await pool.query(
      "SELECT * FROM posts_live WHERE post_id = ?",
      [postId],
    );

    if (lives[0]) {
      post.live = lives[0];
      const [viewers] = await pool.query(
        "SELECT COUNT(*) as viewers_count FROM posts_live_users WHERE post_id = ?",
        [postId],
      );
      post.live.viewers_count = viewers[0]?.viewers_count || 0;
    }
  }

  static async enrichAudioPost(post, postId) {
    const [audios] = await pool.query(
      `SELECT pa.*, COUNT(DISTINCT pav.post_id) as views_count
       FROM posts_audios pa
       LEFT JOIN posts_views pav ON pa.post_id = pav.post_id
       WHERE pa.post_id = ?
       GROUP BY pa.audio_id`,
      [postId],
    );
    post.audio = audios[0] || null;
  }

  static async enrichMediaPost(post, postId) {
    const [medias] = await pool.query(
      "SELECT * FROM posts_media WHERE post_id = ?",
      [postId],
    );
    post.media = medias[0] || null;
  }

  static async enrichProfilePicturePost(post, postId) {
    // For profile picture posts, get the user's picture and add it to photos array
    const [user] = await pool.query(
      `SELECT user_picture FROM users WHERE user_id = ?`,
      [post.user_id],
    );

    if (user && user[0] && user[0].user_picture) {
      post.photos = [
        {
          photo_id: `profile_pic_${post.user_id}`,
          post_id: postId,
          source: user[0].user_picture,
          reactions_count: 0,
          comments_count: 0,
        },
      ];
      post.has_photos = true;
    } else {
      post.photos = [];
      post.has_photos = false;
    }
  }

  static async enrichProfileCoverPost(post, postId) {
    // For profile cover posts, get the user's cover and add it to photos array
    const [user] = await pool.query(
      `SELECT user_cover FROM users WHERE user_id = ?`,
      [post.user_id],
    );

    if (user && user[0] && user[0].user_cover) {
      post.photos = [
        {
          photo_id: `profile_cover_${post.user_id}`,
          post_id: postId,
          source: user[0].user_cover,
          reactions_count: 0,
          comments_count: 0,
        },
      ];
      post.has_photos = true;
    } else {
      post.photos = [];
      post.has_photos = false;
    }
  }

  static async enrichReactionCounts(post, postId) {
    const [reactions] = await pool.query(
      `SELECT 
        pr.reaction,
        COUNT(*) AS count,
        MAX(sr.title) AS reaction_title,
        MAX(sr.image) AS reaction_image,
        MAX(sr.color) AS reaction_color
       FROM posts_reactions pr
       LEFT JOIN system_reactions sr ON pr.reaction = sr.reaction
       WHERE pr.post_id = ?
       GROUP BY pr.reaction
       ORDER BY count DESC`,
      [postId],
    );

    post.reactions = reactions;
    post.reactions_total = reactions.reduce(
      (sum, r) => sum + Number(r.count),
      0,
    );

    const [reactionCounts] = await pool.query(
      `SELECT 
        SUM(pr.reaction = 'like') as reaction_like_count,
        SUM(pr.reaction = 'love') as reaction_love_count,
        SUM(pr.reaction = 'haha') as reaction_haha_count,
        SUM(pr.reaction = 'yay') as reaction_yay_count,
        SUM(pr.reaction = 'wow') as reaction_wow_count,
        SUM(pr.reaction = 'sad') as reaction_sad_count,
        SUM(pr.reaction = 'angry') as reaction_angry_count
       FROM posts_reactions pr
       WHERE pr.post_id = ?`,
      [postId],
    );

    Object.assign(post, reactionCounts[0]);
    post.total_reactions = post.reactions_total;
  }

  static async enrichComments(post, postId, currentUserId) {
    const [comments] = await pool.query(
      `SELECT
        pc.comment_id, pc.node_id, pc.node_type, pc.user_id, pc.user_type,
        pc.text, pc.image, pc.voice_note, pc.time,
        u.user_name, u.user_firstname, u.user_lastname, u.user_picture,
        COALESCE(rc.replies_count, 0) AS replies_count,
        COALESCE(rr.reactions_count, 0) AS comment_reactions_count
       FROM posts_comments pc
       LEFT JOIN users u ON pc.user_id = u.user_id AND pc.user_type = 'user'
       LEFT JOIN (
         SELECT node_id AS comment_id, COUNT(*) AS replies_count
         FROM posts_comments WHERE node_type = 'comment'
         GROUP BY node_id
       ) rc ON rc.comment_id = pc.comment_id
       LEFT JOIN (
         SELECT comment_id, COUNT(*) AS reactions_count
         FROM posts_comments_reactions
         GROUP BY comment_id
       ) rr ON rr.comment_id = pc.comment_id
       WHERE pc.node_id = ? AND pc.node_type = 'post'
       ORDER BY pc.time ASC
       LIMIT 20`,
      [postId],
    );

    if (currentUserId) {
      for (const comment of comments) {
        const [userReaction] = await pool.query(
          "SELECT reaction FROM posts_comments_reactions WHERE comment_id = ? AND user_id = ?",
          [comment.comment_id, currentUserId],
        );
        comment.user_reaction = userReaction[0] || null;
      }
    }

    post.comments_preview = comments;
  }

  static async enrichShares(post, postId) {
    const [shares] = await pool.query(
      `SELECT ps.*,
        u.user_name, u.user_firstname, u.user_lastname, u.user_picture,
        pg.page_name, pg.page_title, pg.page_picture
       FROM posts ps
       LEFT JOIN users u ON ps.user_id = u.user_id AND ps.user_type = 'user'
       LEFT JOIN pages pg ON ps.user_id = pg.page_id AND ps.user_type = 'page'
       WHERE ps.origin_id = ?
       ORDER BY ps.time DESC
       LIMIT 5`,
      [postId],
    );
    post.shares_preview = shares;
  }

  static async enrichHashtags(post, postId) {
    const [hashtags] = await pool.query(
      `SELECT h.hashtag, h.hashtag_id
       FROM hashtags h
       JOIN hashtags_posts hp ON h.hashtag_id = hp.hashtag_id
       WHERE hp.post_id = ?
       ORDER BY h.hashtag ASC`,
      [postId],
    );
    post.hashtags = hashtags;
  }

  static async enrichUserReaction(post, postId, currentUserId) {
    const [userReaction] = await pool.query(
      `SELECT pr.*, sr.title as reaction_title, sr.image as reaction_image, sr.color as reaction_color
       FROM posts_reactions pr
       LEFT JOIN system_reactions sr ON pr.reaction = sr.reaction
       WHERE pr.post_id = ? AND pr.user_id = ?`,
      [postId, currentUserId],
    );
    post.user_reaction = userReaction[0]?.reaction || null;
  }

  static async enrichUserSaved(post, postId, currentUserId) {
    const [saved] = await pool.query(
      "SELECT * FROM posts_saved WHERE post_id = ? AND user_id = ?",
      [postId, currentUserId],
    );
    post.user_saved = saved.length > 0;
    if (post.user_saved) {
      post.saved_time = saved[0].time;
    }
  }

  static async enrichUserShared(post, postId, currentUserId) {
    const [shared] = await pool.query(
      "SELECT post_id FROM posts WHERE user_id = ? AND origin_id = ? AND post_type = 'shared'",
      [currentUserId, postId],
    );
    post.user_shared = shared.length > 0;
  }

  static async enrichSharedPost(post, postId) {
    const [originalPost] = await pool.query(
      `SELECT p.*,
        u.user_name, u.user_firstname, u.user_lastname, u.user_picture,
        pg.page_name, pg.page_title, pg.page_picture
       FROM posts p
       LEFT JOIN users u ON p.user_id = u.user_id AND p.user_type = 'user'
       LEFT JOIN pages pg ON p.user_id = pg.page_id AND p.user_type = 'page'
       WHERE p.post_id = (SELECT origin_id FROM posts WHERE post_id = ?)`,
      [postId],
    );

    if (originalPost[0]) {
      post.original_post = originalPost[0];
    }
  }

  // ==================== POLL INTERACTIONS ====================

  static async voteInPoll({ pollId, optionId, userId }) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Check if already voted
      const [existingVote] = await connection.query(
        `SELECT id FROM posts_polls_options_users WHERE user_id = ? AND poll_id = ?`,
        [userId, pollId],
      );

      if (existingVote.length > 0) {
        throw new Error("You have already voted in this poll");
      }

      // Verify option belongs to poll
      const [option] = await connection.query(
        `SELECT option_id FROM posts_polls_options WHERE option_id = ? AND poll_id = ?`,
        [optionId, pollId],
      );

      if (option.length === 0) {
        throw new Error("Invalid poll option");
      }

      // Insert vote
      await connection.query(
        `INSERT INTO posts_polls_options_users (user_id, poll_id, option_id) VALUES (?, ?, ?)`,
        [userId, pollId, optionId],
      );

      // Update poll votes count
      await connection.query(
        `UPDATE posts_polls SET votes = votes + 1 WHERE poll_id = ?`,
        [pollId],
      );

      // Get updated poll
      const [poll] = await connection.query(
        `SELECT p.*, COUNT(DISTINCT ppou.id) as total_votes
         FROM posts_polls p
         LEFT JOIN posts_polls_options_users ppou ON p.poll_id = ppou.poll_id
         WHERE p.poll_id = ?
         GROUP BY p.poll_id`,
        [pollId],
      );

      const totalVotes = poll[0]?.votes || 1;

      // Get updated options with percentages
      const [options] = await connection.query(
        `SELECT ppo.*,
          COUNT(ppou.id) as votes_count,
          ROUND((COUNT(ppou.id) * 100.0 / NULLIF(?, 0)), 1) as percentage
         FROM posts_polls_options ppo
         LEFT JOIN posts_polls_options_users ppou ON ppo.option_id = ppou.option_id
         WHERE ppo.poll_id = ?
         GROUP BY ppo.option_id
         ORDER BY ppo.option_id ASC`,
        [totalVotes, pollId],
      );

      await connection.commit();

      return {
        success: true,
        poll: poll[0],
        options,
        user_vote: optionId,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async getPollResults(pollId, userId = null) {
    // FIX: use pool directly, no connection variable
    const [poll] = await pool.query(
      `SELECT * FROM posts_polls WHERE poll_id = ?`,
      [pollId],
    );

    if (poll.length === 0) {
      throw new Error("Poll not found");
    }

    const totalVotes = poll[0].votes || 0;

    const [options] = await pool.query(
      `SELECT ppo.*,
        COUNT(ppou.id) as votes_count,
        ROUND((COUNT(ppou.id) * 100.0 / NULLIF(?, 0)), 1) as percentage
       FROM posts_polls_options ppo
       LEFT JOIN posts_polls_options_users ppou ON ppo.option_id = ppou.option_id
       WHERE ppo.poll_id = ?
       GROUP BY ppo.option_id
       ORDER BY ppo.option_id ASC`,
      [totalVotes, pollId],
    );

    let userVote = null;
    if (userId) {
      const [vote] = await pool.query(
        `SELECT option_id FROM posts_polls_options_users WHERE user_id = ? AND poll_id = ?`,
        [userId, pollId],
      );
      userVote = vote[0]?.option_id || null;
    }

    return {
      success: true,
      poll: poll[0],
      options,
      user_vote: userVote,
    };
  }

  // ==================== JOB INTERACTIONS ====================

  static async applyForJob({ postId, userId, applicationData, cvFile = null }) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Check if already applied
      const [existing] = await connection.query(
        `SELECT application_id FROM posts_jobs_applications WHERE post_id = ? AND user_id = ?`,
        [postId, userId],
      );

      if (existing.length > 0) {
        throw new Error("You have already applied for this job");
      }

      // Get job details
      const [job] = await connection.query(
        `SELECT * FROM posts_jobs WHERE post_id = ?`,
        [postId],
      );

      if (job.length === 0) throw new Error("Job not found");
      if (job[0].available === "0")
        throw new Error("This job is no longer available");

      // Handle CV upload
      let cvPath = null;
      if (cvFile) {
        cvFile.originalname = `job-cv-${Date.now()}-${cvFile.originalname}`;
        const cvData = await storageManager.upload(cvFile, "job-cvs");
        cvPath = cvData.path;
      }

      const [result] = await connection.query(
        `INSERT INTO posts_jobs_applications 
         (post_id, user_id, name, location, phone, email, work_place, 
          work_position, work_description, work_from, work_to, work_now,
          question_1_answer, question_2_answer, question_3_answer, cv, applied_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          postId,
          userId,
          applicationData.name,
          applicationData.location || "",
          applicationData.phone,
          applicationData.email,
          applicationData.work_place || null,
          applicationData.work_position || null,
          applicationData.work_description || null,
          applicationData.work_from || null,
          applicationData.work_to || null,
          applicationData.work_now || "0",
          applicationData.question_1_answer || null,
          applicationData.question_2_answer || null,
          applicationData.question_3_answer || null,
          cvPath,
        ],
      );

      await connection.commit();

      return {
        success: true,
        application_id: result.insertId,
        message: "Job application submitted successfully",
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async getJobApplications(postId, employerUserId) {
    // FIX: use pool directly
    const [job] = await pool.query(
      `SELECT p.user_id FROM posts p
       JOIN posts_jobs pj ON p.post_id = pj.post_id
       WHERE p.post_id = ? AND p.user_id = ?`,
      [postId, employerUserId],
    );

    if (job.length === 0) {
      throw new Error("You don't have permission to view these applications");
    }

    const [applications] = await pool.query(
      `SELECT pja.*, u.user_name, u.user_firstname, u.user_lastname, u.user_picture, u.user_email
       FROM posts_jobs_applications pja
       LEFT JOIN users u ON pja.user_id = u.user_id
       WHERE pja.post_id = ?
       ORDER BY pja.applied_time DESC`,
      [postId],
    );

    return { success: true, applications };
  }

  // ==================== FUNDING INTERACTIONS ====================

  static async donateToFunding({ postId, userId, amount, walletBalance }) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      if (walletBalance < amount) {
        throw new Error("Insufficient wallet balance");
      }

      const [funding] = await connection.query(
        `SELECT * FROM posts_funding WHERE post_id = ?`,
        [postId],
      );

      if (funding.length === 0) throw new Error("Funding post not found");

      // Insert donation
      await connection.query(
        `INSERT INTO posts_funding_donors (user_id, post_id, donation_amount, donation_time) VALUES (?, ?, ?, NOW())`,
        [userId, postId, amount],
      );

      // Update funding stats - Make sure this query is correct
      await connection.query(
        `UPDATE posts_funding SET 
    raised_amount = raised_amount + ?,
    total_donations = total_donations + 1 
   WHERE post_id = ?`,
        [amount, postId],
      );

      // Update user wallet
      await connection.query(
        `UPDATE users SET user_wallet_balance = user_wallet_balance - ? WHERE user_id = ?`,
        [amount, userId],
      );

      // Record transaction
      await connection.query(
        `INSERT INTO wallet_transactions (user_id, node_type, node_id, amount, type, description, date) 
       VALUES (?, 'funding', ?, ?, 'out', ?, NOW())`,
        [userId, postId, amount, `Donation to funding post #${postId}`],
      );

      await connection.commit();

      // Get updated funding data with CORRECT SUM calculation
      const [updatedFunding] = await connection.query(
        `SELECT 
        pf.*,
        COUNT(DISTINCT pfd.donation_id) as donors_count,
        COALESCE(SUM(pfd.donation_amount), 0) as raised_amount,
        CASE 
          WHEN pf.amount > 0 
          THEN ROUND((COALESCE(SUM(pfd.donation_amount), 0) * 100.0 / pf.amount), 1)
          ELSE 0 
        END as percentage_funded
       FROM posts_funding pf
        LEFT JOIN posts_funding_donors pfd ON pf.post_id = pfd.post_id
       WHERE pf.post_id = ?
       GROUP BY pf.funding_id`,
        [postId],
      );

      return {
        success: true,
        donation: {
          amount,
          time: new Date(),
        },
        funding: updatedFunding[0]
          ? {
              funding_id: updatedFunding[0].funding_id,
              amount: parseFloat(updatedFunding[0].amount) || 0,
              raised_amount: parseFloat(updatedFunding[0].raised_amount) || 0,
              percentage_funded:
                parseFloat(updatedFunding[0].percentage_funded) || 0,
              donors_count: parseInt(updatedFunding[0].donors_count) || 0,
            }
          : null,
        message: "Donation successful",
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async getFundingDonors(postId, limit = 20, offset = 0) {
    // FIX: use pool directly
    const [donors] = await pool.query(
      `SELECT pfd.*, u.user_name, u.user_firstname, u.user_lastname, u.user_picture
       FROM posts_funding_donors pfd
       LEFT JOIN users u ON pfd.user_id = u.user_id
       WHERE pfd.post_id = ?
       ORDER BY pfd.donation_time DESC
       LIMIT ? OFFSET ?`,
      [postId, limit, offset],
    );

    const [total] = await pool.query(
      `SELECT COUNT(*) as total FROM posts_funding_donors WHERE post_id = ?`,
      [postId],
    );

    return {
      success: true,
      donors,
      total: total[0].total,
      has_more: offset + donors.length < total[0].total,
    };
  }

  // ==================== PRODUCT INTERACTIONS ====================

  static async purchaseProduct({ postId, userId, quantity = 1, addressId }) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [product] = await connection.query(
        `SELECT pp.*, p.user_id as seller_id, p.post_price
         FROM posts_products pp
         JOIN posts p ON pp.post_id = p.post_id
         WHERE pp.post_id = ? AND pp.available = '1'`,
        [postId],
      );

      if (product.length === 0) throw new Error("Product not available");
      if (product[0].quantity < quantity) {
        throw new Error(`Only ${product[0].quantity} items available`);
      }

      const totalAmount = product[0].price * quantity;

      if (product[0].is_digital === "1") {
        return await this.handleDigitalProductPurchase(
          connection,
          postId,
          userId,
          product[0],
        );
      }

      const [orderResult] = await connection.query(
        `INSERT INTO orders 
         (order_hash, is_digital, seller_id, buyer_id, buyer_address_id, sub_total, commission, status, insert_time)
         VALUES (?, '0', ?, ?, ?, ?, ?, 'placed', NOW())`,
        [
          this.generateOrderHash(),
          product[0].seller_id,
          userId,
          addressId,
          totalAmount,
          this.calculateCommission(totalAmount),
        ],
      );

      const orderId = orderResult.insertId;

      await connection.query(
        `INSERT INTO orders_items (order_id, product_post_id, quantity, price) VALUES (?, ?, ?, ?)`,
        [orderId, postId, quantity, product[0].price],
      );

      await connection.query(
        `UPDATE posts_products SET quantity = quantity - ? WHERE product_id = ?`,
        [quantity, product[0].product_id],
      );

      await connection.commit();

      return {
        success: true,
        order_id: orderId,
        message: "Order placed successfully",
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async handleDigitalProductPurchase(
    connection,
    postId,
    userId,
    product,
  ) {
    const downloadUrl =
      product.product_download_url ||
      (product.product_file_source
        ? await this.getSignedUrl(product.product_file_source)
        : null);

    await connection.query(
      `INSERT INTO posts_paid (post_id, user_id, time) VALUES (?, ?, NOW())`,
      [postId, userId],
    );

    await connection.commit();

    return {
      success: true,
      is_digital: true,
      download_url: downloadUrl,
      message: "Purchase successful",
    };
  }

  // ==================== GENERAL INTERACTIONS ====================

  static async reactToPost({ postId, userId, reaction }) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [existing] = await connection.query(
        `SELECT id, reaction FROM posts_reactions WHERE post_id = ? AND user_id = ?`,
        [postId, userId],
      );

      if (existing.length > 0) {
        if (existing[0].reaction === reaction) {
          // Remove reaction (toggle off)
          await connection.query(`DELETE FROM posts_reactions WHERE id = ?`, [
            existing[0].id,
          ]);
          await this.updateReactionCount(connection, postId, reaction, -1);
        } else {
          // Change reaction
          await connection.query(
            `UPDATE posts_reactions SET reaction = ?, reaction_time = NOW() WHERE id = ?`,
            [reaction, existing[0].id],
          );
          await this.updateReactionCount(
            connection,
            postId,
            existing[0].reaction,
            -1,
          );
          await this.updateReactionCount(connection, postId, reaction, 1);
        }
      } else {
        // New reaction
        await connection.query(
          `INSERT INTO posts_reactions (post_id, user_id, reaction, reaction_time) VALUES (?, ?, ?, NOW())`,
          [postId, userId, reaction],
        );
        await this.updateReactionCount(connection, postId, reaction, 1);
      }

      await connection.commit();

      const [counts] = await connection.query(
        `SELECT 
          SUM(reaction = 'like') as reaction_like_count,
          SUM(reaction = 'love') as reaction_love_count,
          SUM(reaction = 'haha') as reaction_haha_count,
          SUM(reaction = 'yay') as reaction_yay_count,
          SUM(reaction = 'wow') as reaction_wow_count,
          SUM(reaction = 'sad') as reaction_sad_count,
          SUM(reaction = 'angry') as reaction_angry_count
         FROM posts_reactions WHERE post_id = ?`,
        [postId],
      );

      return { success: true, counts: counts[0] };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async handleOffer(connection, postId, offerData, thumbnailFile) {
    let thumbnailPath = null;

    if (thumbnailFile && thumbnailFile[0]) {
      const thumbFile = thumbnailFile[0];
      thumbFile.originalname = `offer-thumbnail-${Date.now()}-${thumbFile.originalname}`;
      const thumbnailData = await storageManager.upload(
        thumbFile,
        "offer-thumbnails",
      );
      thumbnailPath = thumbnailData.path;
    }

    const discountType = offerData.discount_type || null;
    let discountPercent = null,
      discountAmount = null;
    let buyX = null,
      getY = null,
      spendX = null,
      amountY = null;

    switch (discountType) {
      case "percent":
        discountPercent = offerData.discount_percent || 0;
        break;
      case "amount":
        discountAmount = offerData.discount_amount || 0;
        break;
      case "bxgy":
        buyX = offerData.buy_x || 0;
        getY = offerData.get_y || 0;
        break;
      case "spend":
        spendX = offerData.spend_x || 0;
        amountY = offerData.amount_y || 0;
        break;
    }

    // ✅ THE FIX: include category_id, default to 1 if not provided
    const categoryId = offerData.category_id || 1;

    const [result] = await connection.query(
      `INSERT INTO posts_offers (
      post_id, category_id, title, discount_type, price, end_date,
      discount_percent, discount_amount, buy_x, get_y, spend_x, amount_y, thumbnail
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        postId,
        categoryId,
        offerData.title || null,
        discountType,
        offerData.price || null,
        offerData.end_date || null,
        discountPercent,
        discountAmount,
        buyX,
        getY,
        spendX,
        amountY,
        thumbnailPath,
      ],
    );

    return result.insertId;
  }

  static async updateReactionCount(connection, postId, reaction, increment) {
    const column = `reaction_${reaction}_count`;
    await connection.query(
      `UPDATE posts SET ${column} = GREATEST(${column} + ?, 0) WHERE post_id = ?`,
      [increment, postId],
    );
  }

  static async savePost({ postId, userId }) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [existing] = await connection.query(
        `SELECT id FROM posts_saved WHERE post_id = ? AND user_id = ?`,
        [postId, userId],
      );

      if (existing.length > 0) {
        await connection.query(`DELETE FROM posts_saved WHERE id = ?`, [
          existing[0].id,
        ]);
        await connection.commit();
        return {
          success: true,
          saved: false,
          message: "Post removed from saved",
        };
      } else {
        await connection.query(
          `INSERT INTO posts_saved (post_id, user_id, time) VALUES (?, ?, NOW())`,
          [postId, userId],
        );
        await connection.commit();
        return {
          success: true,
          saved: true,
          message: "Post saved successfully",
        };
      }
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async sharePost({
    postId,
    userId,
    userType = "user",
    text = null,
    privacy = "public",
  }) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [originalPost] = await connection.query(
        `SELECT * FROM posts WHERE post_id = ?`,
        [postId],
      );

      if (originalPost.length === 0) throw new Error("Original post not found");

      // Check if user has already shared this post
      const [existingShare] = await connection.query(
        `SELECT post_id FROM posts WHERE user_id = ? AND origin_id = ? AND post_type = 'shared'`,
        [userId, postId],
      );

      if (existingShare.length > 0) {
        throw new Error("You have already shared this post");
      }

      const [result] = await connection.query(
        `INSERT INTO posts (user_id, user_type, post_type, text, privacy, time, origin_id) VALUES (?, ?, 'shared', ?, ?, NOW(), ?)`,
        [userId, userType, text, privacy, postId],
      );

      await connection.query(
        `UPDATE posts SET shares = shares + 1 WHERE post_id = ?`,
        [postId],
      );

      await connection.commit();

      return {
        success: true,
        post_id: result.insertId,
        message: "Post shared successfully",
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // ==================== PRIVACY & PERMISSION HELPERS ====================

  static async validatePostPrivacy(privacy, userType) {
    const validPrivacies = ["public", "friends", "only_me"];
    if (userType === "page") validPrivacies.push("page_followers");
    return validPrivacies.includes(privacy);
  }

  static async canUserPostInGroup(userId, groupId) {
    const [membership] = await pool.query(
      `SELECT * FROM groups_members WHERE group_id = ? AND user_id = ? AND approved = '1'`,
      [groupId, userId],
    );
    return membership.length > 0;
  }

  static async canUserPostInEvent(userId, eventId) {
    const [membership] = await pool.query(
      `SELECT * FROM events_members WHERE event_id = ? AND user_id = ? 
       AND (is_going = '1' OR is_interested = '1' OR is_invited = '1')`,
      [eventId, userId],
    );
    return membership.length > 0;
  }

  static async canUserPostOnWall(userId, wallUserId) {
    if (userId === wallUserId) return true;
    const [friendship] = await pool.query(
      `SELECT * FROM friends 
       WHERE ((user_one_id = ? AND user_two_id = ?) OR (user_one_id = ? AND user_two_id = ?)) AND status = 1`,
      [userId, wallUserId, wallUserId, userId],
    );
    return friendship.length > 0;
  }

  static async getPostPrivacyStatus(postId, userId = null) {
    const [posts] = await pool.query(
      "SELECT privacy, user_id, user_type, in_group, group_id, in_event, event_id FROM posts WHERE post_id = ?",
      [postId],
    );

    if (posts.length === 0) return { canView: false, reason: "Post not found" };

    const post = posts[0];

    switch (post.privacy) {
      case "public":
        return { canView: true };

      case "friends":
        if (!userId) return { canView: false, reason: "Login required" };
        const [friendship] = await pool.query(
          `SELECT * FROM friends 
           WHERE ((user_one_id = ? AND user_two_id = ?) OR (user_one_id = ? AND user_two_id = ?)) AND status = 1`,
          [userId, post.user_id, post.user_id, userId],
        );
        return {
          canView: friendship.length > 0,
          reason:
            friendship.length > 0 ? null : "Only friends can view this post",
        };

      case "only_me":
        return {
          canView: userId === post.user_id,
          reason:
            userId === post.user_id
              ? null
              : "Only the author can view this post",
        };

      case "page_followers":
        if (!userId) return { canView: false, reason: "Login required" };
        const [following] = await pool.query(
          "SELECT * FROM pages_likes WHERE page_id = ? AND user_id = ?",
          [post.user_id, userId],
        );
        return {
          canView: following.length > 0,
          reason:
            following.length > 0
              ? null
              : "Only page followers can view this post",
        };

      default:
        return { canView: false, reason: "Invalid privacy setting" };
    }
  }

  static async getPostOwner(postId) {
    const [posts] = await pool.query(
      "SELECT user_id, user_type FROM posts WHERE post_id = ?",
      [postId],
    );

    if (posts.length === 0) return null;
    const post = posts[0];

    if (post.user_type === "user") {
      const [users] = await pool.query(
        "SELECT user_id, user_name, user_firstname, user_lastname, user_picture FROM users WHERE user_id = ?",
        [post.user_id],
      );
      return users[0] || null;
    } else {
      const [pages] = await pool.query(
        "SELECT page_id, page_name, page_title, page_picture FROM pages WHERE page_id = ?",
        [post.user_id],
      );
      return pages[0] || null;
    }
  }

  static async incrementPostViews(postId, userId = null, guestIp = null) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      await connection.query(
        "UPDATE posts SET views = views + 1 WHERE post_id = ?",
        [postId],
      );

      await connection.query(
        "INSERT INTO posts_views (view_date, post_id, user_id, guest_ip) VALUES (NOW(), ?, ?, ?)",
        [postId, userId, guestIp],
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // ==================== UTILITY HELPERS ====================

  static generateOrderHash() {
    return "ORD_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
  }

  static calculateCommission(amount) {
    const commissionRate = 0.05; // 5%
    return amount * commissionRate;
  }

  static async getSignedUrl(filePath) {
    return filePath;
  }

  static async getColoredPatterns() {
    try {
      const [patterns] = await pool.query(
        `SELECT 
          pattern_id as id,
          type,
          background_image,
          background_color_1,
          background_color_2,
          text_color
         FROM posts_colored_patterns
         ORDER BY pattern_id ASC`,
      );
      return patterns || [];
    } catch (error) {
      console.error("Error fetching colored patterns:", error);
      throw error;
    }
  }
}

module.exports = PostService;
