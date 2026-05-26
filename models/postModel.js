// models/postModel.js
const db = require("../config/db");

class PostModel {
  // === CREATE POST ===
  static async createPost(postData) {
    const sql = `
      INSERT INTO posts (
        user_id, post_type, text, privacy, time,
        reaction_like_count, comments, views, points_earned
      ) VALUES (?, ?, ?, ?, NOW(), 0, 0, 0, '0')
    `;
    const values = [
      postData.user_id,
      postData.post_type || "normal",
      postData.text || "",
      postData.privacy || "public",
    ];

    const [result] = await db.query(sql, values);
    return result.insertId;
  }

  static async addMedia(postId, url, mediaType = "image") {
    const sql = `
      INSERT INTO posts_media (post_id, source_url, source_provider, source_type)
      VALUES (?, ?, ?, ?)
    `;
    await db.query(sql, [postId, url, "local", mediaType]);
  }

  // === REUSABLE: Get correct media (handles shared posts!) ===
  static async getMediaForPost(displayPostId, postType, originId = null) {
    let actualPostId = displayPostId;
    if (postType === "shared" && originId) {
      actualPostId = originId;
    }

    let media = [];

    if (
      ["photo", "album", "shared"].includes(postType) ||
      postType.includes("photo")
    ) {
      const [photos] = await db.query(
        `
        SELECT photo_id AS id, source AS url, 'image' AS media_type
        FROM posts_photos WHERE post_id = ? ORDER BY photo_id ASC
      `,
        [actualPostId],
      );
      media = photos;
    } else if (postType.includes("video") || postType === "shared") {
      const [videos] = await db.query(
        `
        SELECT video_id AS id, source AS url, thumbnail, 'video' AS media_type
        FROM posts_videos WHERE post_id = ?
      `,
        [actualPostId],
      );
      media = videos.map((v) => ({
        id: v.id,
        url: v.url,
        thumbnail: v.thumbnail,
        media_type: "video",
      }));
    } else if (postType === "audio") {
      const [audios] = await db.query(
        `
        SELECT audio_id AS id, source AS url, 'audio' AS media_type
        FROM posts_audios WHERE post_id = ?
      `,
        [actualPostId],
      );
      media = audios;
    } else if (postType === "file") {
      const [files] = await db.query(
        `
        SELECT file_id AS id, source AS url, filename, 'file' AS media_type
        FROM posts_files WHERE post_id = ?
      `,
        [actualPostId],
      );
      media = files.map((f) => ({
        id: f.id,
        url: f.url,
        filename: f.filename,
        media_type: "file",
      }));
    }
    // Legacy fallback
    else {
      const [old] = await db.query(
        `
        SELECT media_id AS id, source_url AS url, source_thumbnail AS thumbnail, source_type AS media_type
        FROM posts_media WHERE post_id = ?
      `,
        [actualPostId],
      );
      media = old.map((m) => ({
        id: m.id,
        url: m.url,
        thumbnail: m.thumbnail,
        media_type: m.media_type || "image",
      }));
    }

    return media;
  }

  // === GET SINGLE POST (with user reaction + correct media) ===
  static async getPostById(postId, viewerId = 0) {
    const query = `
    SELECT 
      p.*,
      r.reaction AS user_reaction,
      ${PostModel.getAuthorSelect()},
      EXISTS(SELECT 1 FROM posts_photos ph WHERE ph.post_id = p.post_id) AS has_photos,
      EXISTS(SELECT 1 FROM posts_videos pv WHERE pv.post_id = p.post_id) AS has_video,
      EXISTS(SELECT 1 FROM posts_audios pa WHERE pa.post_id = p.post_id) AS has_audio,
      EXISTS(SELECT 1 FROM posts_articles part WHERE part.post_id = p.post_id) AS has_article,
      EXISTS(SELECT 1 FROM posts_live pl WHERE pl.post_id = p.post_id) AS has_live,
EXISTS(
  SELECT 1 FROM posts_colored_patterns cp 
  WHERE cp.pattern_id = p.colored_pattern
) AS has_colored_pattern
    FROM posts p
    LEFT JOIN posts_reactions r ON r.post_id = p.post_id AND r.user_id = ?
    LEFT JOIN users u ON p.user_type = 'user' AND u.user_id = p.user_id
    LEFT JOIN pages pg ON p.user_type = 'page' AND pg.page_id = p.user_id
    WHERE p.post_id = ? AND p.is_hidden = '0'
  `;

    const [rows] = await db.query(query, [viewerId, postId]);

    if (!rows[0]) return null;

    // This is the magic line
    const enrichedPosts = await PostModel.enrichPostsWithDetails(
      rows,
      viewerId,
    );

    return enrichedPosts[0];
  }

  // === GET USER'S PUBLIC POST COUNT ===
  static async getUserPostCount(userId) {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS post_count FROM posts WHERE user_id = ? AND privacy = 'public'`,
      [userId],
    );
    return Number(rows[0].post_count);
  }

  // === GET USER'S POSTS (PROFILE) ===
  static async getUserPosts(userId, viewerId, limit = 20, offset = 0) {
    const countQuery = `SELECT COUNT(*) AS total FROM posts WHERE user_id = ? AND privacy = 'public'`;
    const postsQuery = `
      SELECT 
        p.post_id AS id,
        p.text AS caption,
        p.post_type,
        p.origin_id,
        p.reaction_like_count AS likes,
        p.comments,
        p.views,
        p.time
      FROM posts p
      WHERE p.user_id = ? AND p.privacy = 'public'
      ORDER BY p.time DESC
      LIMIT ? OFFSET ?
    `;

    const [countRows] = await db.query(countQuery, [userId]);
    const totalCount = Number(countRows[0].total);

    const [postRows] = await db.query(postsQuery, [userId, limit, offset]);

    const posts = await Promise.all(
      postRows.map(async (post) => {
        const media = await PostModel.getMediaForPost(
          post.id,
          post.post_type,
          post.origin_id,
        );

        return {
          id: post.id,
          caption: post.caption || "",
          post_type: post.post_type,
          is_shared: post.post_type === "shared",
          origin_id: post.origin_id || null,
          likes: Number(post.likes) || 0,
          comments: Number(post.comments) || 0,
          views: Number(post.views) || 0,
          time: post.time,
          media,
        };
      }),
    );

    return {
      data: posts,
      total_count: totalCount,
      has_more: offset + posts.length < totalCount,
    };
  }

  // === GET FEED POSTS ===
  static async getFeedPosts(
    viewerId,
    limit = 15,
    last_post_time = null,
    last_post_id = null,
    filter = "all",
  ) {
    const connection = await db.getConnection();

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
      if (last_post_time && last_post_id) {
        paginationCondition = `
        AND (
          p.time < ?
          OR (p.time = ? AND p.post_id < ?)
        )
      `;
        paginationParams = [last_post_time, last_post_time, last_post_id];
      }

      let filterCondition = "";
      let filterParams = [];

      switch (String(filter || "all").toLowerCase()) {
        case "all":
          filterCondition = `
          AND (
            (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL)
            OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
          )
          AND (
            EXISTS(SELECT 1 FROM posts_photos WHERE post_id = p.post_id)
            OR EXISTS(SELECT 1 FROM posts_videos WHERE post_id = p.post_id)
            OR p.colored_pattern IS NOT NULL
            OR EXISTS(SELECT 1 FROM posts_live WHERE post_id = p.post_id AND live_ended = '0')
            OR EXISTS(SELECT 1 FROM posts_links WHERE post_id = p.post_id)
          )
        `;
          break;

        case "friends":
          filterCondition = `
          AND p.in_group = '0'
          AND p.user_type = 'user'
          AND u.user_id IS NOT NULL
          AND u.user_firstname IS NOT NULL
          AND u.user_firstname != ''
          AND EXISTS(
            SELECT 1 FROM friends f
            WHERE (f.user_one_id = p.user_id AND f.user_two_id = ?)
               OR (f.user_one_id = ? AND f.user_two_id = p.user_id)
          )
        `;
          filterParams = [viewerId, viewerId];
          break;

        case "photos":
          filterCondition = `
          AND EXISTS(SELECT 1 FROM posts_photos WHERE post_id = p.post_id)
          AND (
            (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL)
            OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
          )
        `;
          break;

        case "videos":
          filterCondition = `
          AND EXISTS(SELECT 1 FROM posts_videos WHERE post_id = p.post_id)
          AND (
            (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL)
            OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
          )
        `;
          break;

        case "colored":
          filterCondition = `
          AND EXISTS(SELECT 1 FROM posts_colored_patterns cp WHERE cp.pattern_id = p.colored_pattern)
          AND (
            (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL)
            OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
          )
        `;
          break;

        case "live":
          filterCondition = `
          AND EXISTS(SELECT 1 FROM posts_live WHERE post_id = p.post_id AND live_ended = '0')
          AND (
            (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL)
            OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
          )
        `;
          break;

        case "links":
          filterCondition = `
          AND EXISTS(SELECT 1 FROM posts_links WHERE post_id = p.post_id)
          AND (
            (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL)
            OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
          )
        `;
          break;

        case "audio":
          filterCondition = `
          AND EXISTS(SELECT 1 FROM posts_audios WHERE post_id = p.post_id)
          AND (
            (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL)
            OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
          )
        `;
          break;

        case "articles":
          filterCondition = `
          AND EXISTS(SELECT 1 FROM posts_articles WHERE post_id = p.post_id)
          AND (
            (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL)
            OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
          )
        `;
          break;

        case "products":
          filterCondition = `
          AND EXISTS(SELECT 1 FROM posts_products WHERE post_id = p.post_id)
          AND (
            (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL)
            OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
          )
        `;
          break;

        case "jobs":
          filterCondition = `
          AND EXISTS(SELECT 1 FROM posts_jobs WHERE post_id = p.post_id)
          AND (
            (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL)
            OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
          )
        `;
          break;

        case "polls":
          filterCondition = `
          AND EXISTS(SELECT 1 FROM posts_polls WHERE post_id = p.post_id)
          AND (
            (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL)
            OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
          )
        `;
          break;

        default:
          filterCondition = `
          AND (
            (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL)
            OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
          )
        `;
          break;
      }

      const query = `
      SELECT * FROM (
        SELECT
          p.post_id,
          p.user_id,
          p.user_type,
          p.post_type,
          p.text,
          p.time,
          p.privacy,
          p.views,
          p.comments,
          p.shares,
          p.boosted,
          p.in_group,
          p.group_id,
          p.in_event,
          p.event_id,
          p.origin_id,
          p.colored_pattern,

          cp.type AS pattern_type,
          cp.background_image,
          cp.background_color_1,
          cp.background_color_2,
          cp.text_color,

          p.is_paid,
          p.paid_text,
          p.location,
          p.feeling_action,
          p.feeling_value,
          p.for_adult,
          p.is_anonymous,
          p.tips_enabled,
          p.for_subscriptions,

          p.reaction_like_count,
          p.reaction_love_count,
          p.reaction_haha_count,
          p.reaction_yay_count,
          p.reaction_wow_count,
          p.reaction_sad_count,
          p.reaction_angry_count,

          pr.reaction AS user_reaction,

          ${PostModel.getAuthorSelect()},

          g.group_title,
          e.event_title,

          op.post_id AS shared_post_id,
          op.text AS shared_text,
          ou.user_firstname AS shared_user_name,
          ou.user_name AS shared_username,

          EXISTS(SELECT 1 FROM posts_photos  ph    WHERE ph.post_id    = p.post_id) AS has_photos,
          EXISTS(SELECT 1 FROM posts_videos  pv    WHERE pv.post_id    = p.post_id) AS has_video,
          EXISTS(SELECT 1 FROM posts_audios  pa    WHERE pa.post_id    = p.post_id) AS has_audio,
          EXISTS(SELECT 1 FROM posts_files   pf    WHERE pf.post_id    = p.post_id) AS has_file,
          EXISTS(SELECT 1 FROM posts_links   pl    WHERE pl.post_id    = p.post_id) AS has_link,
          EXISTS(SELECT 1 FROM posts_articles part WHERE part.post_id  = p.post_id) AS has_article,
          EXISTS(SELECT 1 FROM posts_products pprod WHERE pprod.post_id = p.post_id) AS has_product,
          EXISTS(SELECT 1 FROM posts_jobs     pj   WHERE pj.post_id    = p.post_id) AS has_job,
          EXISTS(SELECT 1 FROM posts_polls    pp   WHERE pp.post_id    = p.post_id) AS has_poll,
          EXISTS(SELECT 1 FROM posts_live     plive
                 WHERE plive.post_id = p.post_id AND plive.live_ended = '0') AS has_live,
          (cp.pattern_id IS NOT NULL) AS has_colored_pattern

        FROM posts p

        LEFT JOIN users u
          ON p.user_type = 'user' AND u.user_id = p.user_id

        LEFT JOIN pages pg
          ON p.user_type = 'page' AND pg.page_id = p.user_id

        LEFT JOIN posts_reactions pr
          ON pr.post_id = p.post_id AND pr.user_id = ?

        LEFT JOIN posts_colored_patterns cp
          ON cp.pattern_id = p.colored_pattern

        LEFT JOIN \`groups\` g
          ON p.in_group = '1' AND g.group_id = p.group_id

        LEFT JOIN \`events\` e
          ON p.in_event = '1' AND e.event_id = p.event_id

        LEFT JOIN posts op
          ON op.post_id = p.origin_id

        LEFT JOIN users ou
          ON op.user_type = 'user' AND ou.user_id = op.user_id

        WHERE p.is_hidden = '0'
          AND p.in_wall = '0'
          AND p.has_approved = '1'
          ${blockCondition}
          ${filterCondition}
          ${paginationCondition}
      ) AS filtered_posts

      WHERE (
        privacy = 'public'
        
        OR (
          privacy = 'friends' 
          AND user_type = 'user' 
          AND in_group = '0'
          AND EXISTS(
            SELECT 1 FROM friends f
            WHERE (f.user_one_id = user_id AND f.user_two_id = ?)
               OR (f.user_one_id = ? AND f.user_two_id = user_id)
          )
        )
        
        OR user_id = ?
        
        OR (
          user_type = 'page'
          AND (
            EXISTS(SELECT 1 FROM pages_likes pl WHERE pl.page_id = user_id AND pl.user_id = ?)
            OR EXISTS(SELECT 1 FROM pages_admins pa WHERE pa.page_id = user_id AND pa.user_id = ?)
          )
        )
        
        OR (
          in_group = '1'
          AND EXISTS(
            SELECT 1 FROM groups_members gm
            WHERE gm.group_id = group_id
              AND gm.user_id = ?
              AND gm.approved = '1'
          )
        )
        
        OR (
          in_event = '1'
          AND EXISTS(
            SELECT 1 FROM events_members em
            WHERE em.event_id = event_id
              AND em.user_id = ?
              AND (em.is_going = '1' OR em.is_interested = '1' OR em.is_invited = '1')
          )
        )
      )

      ORDER BY
        boosted DESC,
        time DESC,
        post_id DESC

      LIMIT ?
    `;

      const params = [
        viewerId,
        ...blockParams,
        ...filterParams,
        ...paginationParams,
        viewerId,
        viewerId,
        viewerId,
        viewerId,
        viewerId,
        viewerId,
        viewerId,
        limitPlusOne,
      ];

      const [rows] = await connection.query(query, params);

      const has_more = rows.length > requestedLimit;
      const pageRows = has_more ? rows.slice(0, requestedLimit) : rows;

      const postsWithDetails = await PostModel.enrichPostsWithDetails(
        pageRows,
        viewerId,
      );

      const last = pageRows[pageRows.length - 1] || null;
      const next_cursor =
        has_more && last
          ? { last_post_time: last.time, last_post_id: last.post_id }
          : null;

      return {
        data: postsWithDetails,
        has_more,
        next_cursor,
      };
    } finally {
      connection.release();
    }
  }

  static buildPrivacyConditions(viewerId) {
    const conditions = `
    AND (
      -- Public posts
      p.privacy = 'public'

      -- Friends-only posts (only show if viewer is friend AND post is NOT in a group)
      OR (
        p.privacy = 'friends'
        AND p.user_type = 'user'
        AND p.in_group = '0'  -- Explicitly exclude group posts for friends-only privacy
        AND EXISTS(
          SELECT 1 FROM friends f
          WHERE (f.user_one_id = p.user_id AND f.user_two_id = ?)
             OR (f.user_one_id = ? AND f.user_two_id = p.user_id)
        )
      )

      -- Own posts
      OR p.user_id = ?

      -- Page posts (user likes or admins the page)
      OR (
        p.user_type = 'page'
        AND (
          EXISTS(SELECT 1 FROM pages_likes  pl WHERE pl.page_id = p.user_id AND pl.user_id = ?)
          OR EXISTS(SELECT 1 FROM pages_admins pa WHERE pa.page_id = p.user_id AND pa.user_id = ?)
        )
      )

      -- Group posts (only show if viewer is a member of the group)
      OR (
        p.in_group = '1'
        AND EXISTS(
          SELECT 1 FROM groups_members gm
          WHERE gm.group_id = p.group_id
            AND gm.user_id = ?
            AND gm.approved = '1'
        )
      )

      -- Event posts (only show if viewer is going/interested/invited)
      OR (
        p.in_event = '1'
        AND EXISTS(
          SELECT 1 FROM events_members em
          WHERE em.event_id = p.event_id
            AND em.user_id = ?
            AND (em.is_going = '1' OR em.is_interested = '1' OR em.is_invited = '1')
        )
      )
    )
  `;

    const params = [
      viewerId, // friends - user one
      viewerId, // friends - user two
      viewerId, // own posts
      viewerId, // page like
      viewerId, // page admin
      viewerId, // group member
      viewerId, // event member
    ];

    return { conditions, params };
  }

  static buildFilterConditions(filter, viewerId) {
    let conditions = "";
    let params = [];

    switch (String(filter || "all").toLowerCase()) {
      case "all":
        // For "All" filter, show posts with media content
        // IMPORTANT: For "All" filter, we should NOT show group posts where user is not a member
        conditions = `
        AND (
          -- Personal posts (user_type = 'user' and NOT in group)
          (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL AND u.user_firstname IS NOT NULL AND u.user_firstname != '')
          
          -- OR page posts
          OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
          
        )
        AND (
          EXISTS(SELECT 1 FROM posts_photos WHERE post_id = p.post_id)
          OR EXISTS(SELECT 1 FROM posts_videos WHERE post_id = p.post_id)
          OR p.colored_pattern IS NOT NULL
          OR EXISTS(SELECT 1 FROM posts_live WHERE post_id = p.post_id AND live_ended = '0')
          OR EXISTS(SELECT 1 FROM posts_links WHERE post_id = p.post_id)
        )
      `;
        break;

      case "friends":
        // Friends filter - only show personal posts from friends, not group posts
        conditions = `
        AND p.in_group = '0'  -- Explicitly exclude ALL group posts
        AND p.user_type = 'user'
        AND u.user_id IS NOT NULL 
        AND u.user_firstname IS NOT NULL 
        AND u.user_firstname != ''
        -- Ensure it's actually a friend's post
        AND EXISTS(
          SELECT 1 FROM friends f
          WHERE (f.user_one_id = p.user_id AND f.user_two_id = ?)
             OR (f.user_one_id = ? AND f.user_two_id = p.user_id)
        )
      `;
        params = [viewerId, viewerId];
        break;

      case "photos":
        conditions = `
        AND (
          -- Personal posts (user_type = 'user' and NOT in group)
          (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL AND u.user_firstname IS NOT NULL AND u.user_firstname != '')
          OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
        )
        AND EXISTS(SELECT 1 FROM posts_photos WHERE post_id = p.post_id)
      `;
        break;

      case "videos":
        conditions = `
        AND (
          -- Personal posts (user_type = 'user' and NOT in group)
          (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL AND u.user_firstname IS NOT NULL AND u.user_firstname != '')
          OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
        )
        AND EXISTS(SELECT 1 FROM posts_videos WHERE post_id = p.post_id)
      `;
        break;

      case "colored":
        conditions = `
        AND (
          -- Personal posts (user_type = 'user' and NOT in group)
          (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL AND u.user_firstname IS NOT NULL AND u.user_firstname != '')
          OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
        )
        AND EXISTS(SELECT 1 FROM posts_colored_patterns cp WHERE cp.pattern_id = p.colored_pattern)
      `;
        break;

      case "live":
        conditions = `
        AND (
          -- Personal posts (user_type = 'user' and NOT in group)
          (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL AND u.user_firstname IS NOT NULL AND u.user_firstname != '')
          OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
          OR (p.in_group = '1')
        )
        AND EXISTS(SELECT 1 FROM posts_live WHERE post_id = p.post_id AND live_ended = '0')
      `;
        break;

      case "links":
        conditions = `
        AND (
          -- Personal posts (user_type = 'user' and NOT in group)
          (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL AND u.user_firstname IS NOT NULL AND u.user_firstname != '')
          OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
          OR (p.in_group = '1')
        )
        AND EXISTS(SELECT 1 FROM posts_links WHERE post_id = p.post_id)
      `;
        break;

      case "audio":
        conditions = `
        AND (
          -- Personal posts (user_type = 'user' and NOT in group)
          (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL AND u.user_firstname IS NOT NULL AND u.user_firstname != '')
          OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
          OR (p.in_group = '1')
        )
        AND EXISTS(SELECT 1 FROM posts_audios WHERE post_id = p.post_id)
      `;
        break;

      case "articles":
        conditions = `
        AND (
          -- Personal posts (user_type = 'user' and NOT in group)
          (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL AND u.user_firstname IS NOT NULL AND u.user_firstname != '')
          OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
          OR (p.in_group = '1')
        )
        AND EXISTS(SELECT 1 FROM posts_articles WHERE post_id = p.post_id)
      `;
        break;

      case "products":
        conditions = `
        AND (
          -- Personal posts (user_type = 'user' and NOT in group)
          (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL AND u.user_firstname IS NOT NULL AND u.user_firstname != '')
          OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
          OR (p.in_group = '1')
        )
        AND EXISTS(SELECT 1 FROM posts_products WHERE post_id = p.post_id)
      `;
        break;

      case "jobs":
        conditions = `
        AND (
          -- Personal posts (user_type = 'user' and NOT in group)
          (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL AND u.user_firstname IS NOT NULL AND u.user_firstname != '')
          OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
          OR (p.in_group = '1')
        )
        AND EXISTS(SELECT 1 FROM posts_jobs WHERE post_id = p.post_id)
      `;
        break;

      case "polls":
        conditions = `
        AND (
          -- Personal posts (user_type = 'user' and NOT in group)
          (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL AND u.user_firstname IS NOT NULL AND u.user_firstname != '')
          OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
          OR (p.in_group = '1')
        )
        AND EXISTS(SELECT 1 FROM posts_polls WHERE post_id = p.post_id)
      `;
        break;

      default:
        // Default: show all posts including group posts (will be filtered by privacy)
        conditions = `
        AND (
          (p.user_type = 'user' AND p.in_group = '0' AND u.user_id IS NOT NULL AND u.user_firstname IS NOT NULL AND u.user_firstname != '')
          OR (p.user_type = 'page' AND pg.page_id IS NOT NULL)
          OR (p.in_group = '1')
        )
      `;
        break;
    }

    return { conditions, params };
  }

  static getAuthorSelect() {
    return `
      COALESCE(u.user_firstname, pg.page_title) AS author_name,
      COALESCE(u.user_name, pg.page_name) AS author_username,
      COALESCE(u.user_picture, pg.page_picture) AS author_picture,
      COALESCE(u.user_verified, pg.page_verified) AS author_verified,
      CASE WHEN p.user_type = 'page' THEN pg.page_id ELSE u.user_id END AS author_id,
      p.user_type AS author_type
    `;
  }

  static getConditionalJoins(filter, viewerId) {
    const joins = [];
    const params = [];

    // Only join tables needed for the specific filter
    switch (filter.toLowerCase()) {
      case "videos":
        joins.push("LEFT JOIN posts_videos v ON v.post_id = p.post_id");
        break;
      case "audio":
        joins.push("LEFT JOIN posts_audios aud ON aud.post_id = p.post_id");
        break;
      case "articles":
        joins.push("LEFT JOIN posts_articles a ON a.post_id = p.post_id");
        break;
      case "products":
        joins.push("LEFT JOIN posts_products prd ON prd.post_id = p.post_id");
        break;
      case "jobs":
        joins.push("LEFT JOIN posts_jobs j ON j.post_id = p.post_id");
        break;
      case "polls":
        joins.push("LEFT JOIN posts_polls pl ON pl.post_id = p.post_id");
        joins.push(
          "LEFT JOIN posts_polls_options_users po ON po.poll_id = pl.poll_id AND po.user_id = ?",
        );
        params.push(viewerId);
        break;
      case "live":
        joins.push("LEFT JOIN posts_live live ON live.post_id = p.post_id");
        break;
      default:
        // For 'all' filter, join minimally
        break;
    }

    return {
      joins: joins.join("\n"),
      joinParams: params,
    };
  }

  static async enrichPostsWithDetails(rows, viewerId) {
    if (!rows || rows.length === 0) return [];

    const postIds = rows.map((r) => r.post_id);
    const connection = await db.getConnection();

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
      const needLive = rows.some((r) => Number(r.has_live) === 1);

      // Photos (aggregate per post)
      let photosMap = new Map();
      if (needPhotos) {
        const [photosAgg] = await connection.query(
          `
          SELECT
            post_id,
            JSON_ARRAYAGG(
              JSON_OBJECT('photo_id', photo_id, 'source', source, 'blur', blur)
            ) AS photos
          FROM posts_photos
          WHERE post_id IN (?)
          GROUP BY post_id
          `,
          [postIds],
        );

        photosMap = new Map(
          photosAgg.map((p) => {
            let arr = [];
            if (p.photos) {
              if (typeof p.photos === "string") {
                try {
                  arr = JSON.parse(p.photos);
                } catch (_) {
                  arr = [];
                }
              } else if (Array.isArray(p.photos)) {
                arr = p.photos;
              }
            }
            return [p.post_id, arr];
          }),
        );
      }

      // Videos
      let videosMap = new Map();
      if (needVideos) {
        const [videos] = await connection.query(
          `
          SELECT post_id, video_id, source, thumbnail
          FROM posts_videos
          WHERE post_id IN (?)
          `,
          [postIds],
        );
        videosMap = new Map(videos.map((v) => [v.post_id, v]));
      }

      // Audios
      let audiosMap = new Map();
      if (needAudios) {
        const [audios] = await connection.query(
          `
          SELECT post_id, audio_id, source
          FROM posts_audios
          WHERE post_id IN (?)
          `,
          [postIds],
        );
        audiosMap = new Map(audios.map((a) => [a.post_id, a]));
      }

      // Files
      let filesMap = new Map();
      if (needFiles) {
        const [files] = await connection.query(
          `
          SELECT post_id, file_id, source, filename
          FROM posts_files
          WHERE post_id IN (?)
          `,
          [postIds],
        );
        filesMap = new Map(files.map((f) => [f.post_id, f]));
      }

      // Links
      let linksMap = new Map();
      if (needLinks) {
        const [links] = await connection.query(
          `
          SELECT post_id, link_id, source_url, source_title, source_thumbnail, source_text
          FROM posts_links
          WHERE post_id IN (?)
          `,
          [postIds],
        );
        linksMap = new Map(links.map((l) => [l.post_id, l]));
      }

      // Polls
      let pollsMap = new Map();
      if (needPolls) {
        const [polls] = await connection.query(
          `
          SELECT poll_id, post_id, votes
          FROM posts_polls
          WHERE post_id IN (?)
          `,
          [postIds],
        );
        pollsMap = new Map(polls.map((p) => [p.post_id, p]));
      }

      // Articles
      let articlesMap = new Map();
      if (needArticles) {
        const [articles] = await connection.query(
          `
          SELECT post_id, article_id, title, cover, text
          FROM posts_articles
          WHERE post_id IN (?)
          `,
          [postIds],
        );
        articlesMap = new Map(articles.map((a) => [a.post_id, a]));
      }

      // Products
      let productsMap = new Map();
      if (needProducts) {
        const [products] = await connection.query(
          `
          SELECT post_id, product_id, name, price
          FROM posts_products
          WHERE post_id IN (?)
          `,
          [postIds],
        );
        productsMap = new Map(products.map((p) => [p.post_id, p]));
      }

      // Jobs
      let jobsMap = new Map();
      if (needJobs) {
        const [jobs] = await connection.query(
          `
          SELECT post_id, job_id, title, location, salary_minimum, salary_maximum
          FROM posts_jobs
          WHERE post_id IN (?)
          `,
          [postIds],
        );
        jobsMap = new Map(jobs.map((j) => [j.post_id, j]));
      }

      // Live
      let liveMap = new Map();
      if (needLive) {
        const [live] = await connection.query(
          `
          SELECT post_id, live_id, video_thumbnail, live_ended
          FROM posts_live
          WHERE post_id IN (?)
          `,
          [postIds],
        );
        liveMap = new Map(live.map((l) => [l.post_id, l]));
      }

      return rows.map((row) =>
        PostModel.formatPost(
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
          liveMap,
        ),
      );
    } finally {
      connection.release();
    }
  }

  // -------------------------------------------
  // FORMAT POST OUTPUT (MATCHES YOUR FRONTEND EXPECTATIONS)
  // -------------------------------------------
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
    liveMap,
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
    const liveRow = liveMap.get(row.post_id) || null;

    return {
      post_id: row.post_id,
      type: row.post_type,
      text: row.text || "",
      time: row.time,
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

      author: {
        id: row.author_id,
        type: row.author_type,
        name: row.author_name || "User",
        username: row.author_username,
        picture: row.author_picture,
        verified: row.author_verified === "1" || row.author_verified === 1,
      },

      reactions: {
        like: Number(row.reaction_like_count) || 0,
        love: Number(row.reaction_love_count) || 0,
        haha: Number(row.reaction_haha_count) || 0,
        yay: Number(row.reaction_yay_count) || 0,
        wow: Number(row.reaction_wow_count) || 0,
        sad: Number(row.reaction_sad_count) || 0,
        angry: Number(row.reaction_angry_count) || 0,
      },
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
      has_live: Number(row.has_live) === 1,
      has_colored_pattern: Number(row.has_colored_pattern) === 1,

      photos: photosArr,

      video: videoRow
        ? {
            id: videoRow.video_id,
            source: videoRow.source,
            thumbnail: videoRow.thumbnail,
          }
        : null,

      audio: audioRow
        ? { id: audioRow.audio_id, source: audioRow.source }
        : null,

      file: fileRow
        ? {
            id: fileRow.file_id,
            source: fileRow.source,
            filename: fileRow.filename,
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
        ? { id: pollRow.poll_id, votes: Number(pollRow.votes) || 0 }
        : null,

      article: articleRow
        ? {
            id: articleRow.article_id,
            title: articleRow.title,
            cover: articleRow.cover,
            text: articleRow.text,
          }
        : null,

      product: productRow
        ? {
            id: productRow.product_id,
            name: productRow.name,
            price: productRow.price,
          }
        : null,

      job: jobRow
        ? {
            id: jobRow.job_id,
            title: jobRow.title,
            location: jobRow.location,
            salary_minimum: jobRow.salary_minimum,
            salary_maximum: jobRow.salary_maximum,
          }
        : null,

      live: liveRow
        ? {
            id: liveRow.live_id,
            thumbnail: liveRow.video_thumbnail,
            ended: liveRow.live_ended === "1" || liveRow.live_ended === 1,
          }
        : null,

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

  // static logPhotoPostDebugInfo(posts) {
  //   const photoPosts = posts.filter((p) => p.has_photos);

  //   if (photoPosts.length === 0) {
  //     console.log("📸 No posts with has_photos flag");
  //     return;
  //   }

  //   console.log("📸 PHOTO POSTS DEBUG ================");
  //   photoPosts.forEach((post, index) => {
  //     console.log(`Post ${index + 1}:`);
  //     console.log(`  ID: ${post.post_id}`);
  //     console.log(`  has_photos: ${post.has_photos}`);
  //     console.log(`  photos array exists: ${!!post.photos}`);
  //     console.log(`  photos count: ${post.photos?.length || 0}`);
  //     console.log(
  //       `  photos in array:`,
  //       post.photos?.map((p) => p.source) || "none"
  //     );
  //     console.log(`  has_video: ${post.has_video}`);
  //     console.log(`  type: ${post.type}`);
  //     console.log(`  text preview: ${post.text?.substring(0, 50)}...`);
  //     console.log("---");
  //   });
  //   console.log("📸 END DEBUG =======================");
  // }

  static async getFeedPostsCount(
    viewerId,
    filter,
    privacyConditions,
    blockCondition,
    filterConditions,
    privacyParams,
  ) {
    const connection = await db.getConnection();

    try {
      let countQuery = `
        SELECT COUNT(DISTINCT p.post_id) as total
        FROM posts p
        WHERE p.is_hidden = '0'
          AND p.in_wall = '0'
          AND p.has_approved = '1'
          ${privacyConditions}
          ${blockCondition}
          ${filterConditions}
      `;

      const { params: filterParams } = PostModel.buildFilterConditions(
        filter,
        viewerId,
      );

      const countParams = [
        ...privacyParams,
        viewerId,
        viewerId, // block condition
        ...filterParams,
      ];

      const [[{ total }]] = await connection.query(countQuery, countParams);
      return Number(total);
    } finally {
      connection.release();
    }
  }

  // === RECORD POST VIEW (with points & deduplication) ===
  static async recordPostView(postId, viewerId, guestIp = null) {
    const connection = await db.getConnection();
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
        await connection.query(
          `UPDATE users SET user_points = user_points + 0.1 WHERE user_id = ?`,
          [viewerId],
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
}

module.exports = PostModel;
