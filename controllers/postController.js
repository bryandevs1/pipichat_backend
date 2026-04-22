// controllers/postController.js
const Joi = require("joi");
const Post = require("../models/postModel");
const PostService = require("../services/Postservice");
const { uploadToGoogleCloud } = require("../utils/googleCloud");
const PointsService = require("../services/pointsService");
const NotificationService = require("../services/notificationService");
const POINTS_CONFIG = require("../utils/pointsConfig");
const db = require("../config/db");

const postController = {
  // ==================== CREATE POST ====================
  createPost: async (req, res) => {
    try {
      const user_id = req.user?.id;
      if (!user_id) {
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });
      }

      const {
        post_type = "text",
        text,
        privacy = "public",
        disable_comments,
        is_anonymous,
        for_adult,
        for_subscriptions,
        tips_enabled,
        is_paid,
        post_price,
        paid_text,
        location,
        feeling_action,
        feeling_value,
        colored_pattern,
      } = req.body;

      // Parse offer data if it exists
      let offerData = null;
      if (req.body.offer_data) {
        try {
          offerData =
            typeof req.body.offer_data === "string"
              ? JSON.parse(req.body.offer_data)
              : req.body.offer_data;
        } catch (e) {
          console.error("Failed to parse offer_data:", e);
        }
      }

      const result = await PostService.createPost({
        userId: user_id,
        userType: "user",
        text: text || "",
        privacy,
        postType: post_type,
        location,
        feeling_action,
        feeling_value,
        colored_pattern,
        disableComments:
          disable_comments === true || disable_comments === "true",
        isAnonymous: is_anonymous === true || is_anonymous === "true",
        forAdult: for_adult === true || for_adult === "true",
        forSubscriptions:
          for_subscriptions === true || for_subscriptions === "true",
        tipsEnabled: tips_enabled === true || tips_enabled === "true",
        isPaid: is_paid === true || is_paid === "true",
        postPrice: post_price ? parseFloat(post_price) : 0,
        paidText: paid_text || null,
        files: {
          photos: req.files?.photos || [],
          videos: req.files?.videos || [],
          cover: req.files?.cover || [],
          coverImage: req.files?.cover_image || [],
          articleData: req.body.article_data
            ? JSON.parse(req.body.article_data)
            : null,
          pollData: req.body.poll_data ? JSON.parse(req.body.poll_data) : null,
          jobData: req.body.job_data ? JSON.parse(req.body.job_data) : null,
          productData: req.body.product_data
            ? JSON.parse(req.body.product_data)
            : null,
          fundingData: req.body.funding_data
            ? JSON.parse(req.body.funding_data)
            : null,
          liveData: req.body.live_data ? JSON.parse(req.body.live_data) : null,
          audio: req.files?.audio || [],
          productImages: req.files?.product_images || [],
          thumbnail: req.files?.thumbnail || [],
          // Add offer data
          offerData: offerData,
        },
      });

      // ✅ Add points for creating a post
      await PointsService.addPoints(
        user_id,
        POINTS_CONFIG.ACTIVITIES.POST_CREATED,
        "post_created",
        result.postId,
        `Posted new content (${post_type})`,
      );

      res.json({
        success: true,
        message: "Post created successfully",
        data: { post_id: result.postId },
      });
    } catch (error) {
      console.error("Create post error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // ==================== CREATE JOB ====================
  createJob: async (req, res) => {
    try {
      const {
        user_id,
        title,
        location,
        salary_minimum,
        salary_maximum,
        pay_salary_per,
        type,
        category_id,
        text,
        available = "1",
        questions,
      } = req.body;

      let coverImageUrl = null;
      if (req.file) {
        const uploadResult = await uploadToGoogleCloud(req.file, "jobs");
        coverImageUrl = uploadResult.url;
      }

      const questionData =
        typeof questions === "string" ? JSON.parse(questions) : questions;

      const postData = {
        user_id,
        post_type: "job",
        text: text || "",
        privacy: "public",
        job_data: {
          title,
          location,
          salary_minimum: parseFloat(salary_minimum),
          salary_maximum: parseFloat(salary_maximum),
          pay_salary_per,
          type,
          category_id: parseInt(category_id),
          cover_image: coverImageUrl,
          available,
          questions: questionData || [],
        },
      };

      const postId = await PostService.createPost(postData);

      res.json({
        success: true,
        message: "Job created successfully",
        data: { post_id: postId },
      });
    } catch (error) {
      console.error("Create job error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create job",
        error: error.message,
      });
    }
  },

  // ==================== CREATE ARTICLE ====================
  createArticle: async (req, res) => {
    try {
      const { user_id, title, text, category_id = 1, tags = "" } = req.body;

      let coverImageUrl = null;
      if (req.file) {
        const uploadResult = await uploadToGoogleCloud(req.file, "articles");
        coverImageUrl = uploadResult.url;
      }

      const postData = {
        user_id,
        post_type: "article",
        text: text || "",
        privacy: "public",
        article_data: {
          title,
          text,
          cover: coverImageUrl,
          category_id: parseInt(category_id),
          tags,
        },
      };

      const postId = await PostService.createPost(postData);

      res.json({
        success: true,
        message: "Article created successfully",
        data: { post_id: postId },
      });
    } catch (error) {
      console.error("Create article error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create article",
        error: error.message,
      });
    }
  },

  // ==================== CREATE POLL ====================
  createPoll: async (req, res) => {
    try {
      const { user_id, question, options, text = "" } = req.body;

      const optionsData =
        typeof options === "string" ? JSON.parse(options) : options;

      const postData = {
        user_id,
        post_type: "poll",
        text: text || question || "",
        privacy: "public",
        poll_data: { options: optionsData },
      };

      const postId = await PostService.createPost(postData);

      res.json({
        success: true,
        message: "Poll created successfully",
        data: { post_id: postId },
      });
    } catch (error) {
      console.error("Create poll error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create poll",
        error: error.message,
      });
    }
  },

  // ==================== UPLOAD MEDIA ====================
  uploadMedia: async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: "No file uploaded" });
      }

      const uploadResult = await uploadToGoogleCloud(req.file, "media");

      res.json({
        success: true,
        message: "File uploaded successfully",
        data: { url: uploadResult.url, filename: uploadResult.filename },
      });
    } catch (error) {
      console.error("Upload media error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to upload file",
        error: error.message,
      });
    }
  },

  // ==================== GET CATEGORIES ====================
  getCategories: async (req, res) => {
    const startTime = Date.now();

    console.log("========== GET CATEGORIES START ==========");
    console.log("Time:", new Date().toISOString());
    console.log("Method:", req.method);
    console.log("URL:", req.originalUrl);
    console.log("Query Params:", req.query);
    console.log("Headers:", {
      authorization: req.headers.authorization,
      contentType: req.headers["content-type"],
      userAgent: req.headers["user-agent"],
    });
    console.log("IP Address:", req.ip);

    try {
      const { type = "posts" } = req.query;

      console.log("Resolved Type:", type);
      console.log("Calling PostService.getCategories...");

      const categories = await PostService.getCategories(type);

      console.log("Service Response Count:", categories?.length || 0);
      console.log("Service Raw Response:", categories);

      const duration = Date.now() - startTime;
      console.log("Execution Time:", `${duration}ms`);
      console.log("========== GET CATEGORIES SUCCESS ==========");

      res.json({
        success: true,
        data: categories,
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      console.error("========== GET CATEGORIES ERROR ==========");
      console.error("Time:", new Date().toISOString());
      console.error("Execution Time:", `${duration}ms`);
      console.error("Error Name:", error.name);
      console.error("Error Message:", error.message);
      console.error("Error Stack:", error.stack);
      console.error("Full Error Object:", error);

      res.status(500).json({
        success: false,
        message: "Failed to fetch categories",
        error: error.message,
      });
    }
  },

  // ==================== GET SINGLE POST ====================
  getPost: async (req, res) => {
    try {
      const postId = parseInt(req.params.id);
      if (!postId || postId <= 0) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid post ID" });
      }

      // FIX: use req.user?.id not req.user?.user_id
      const viewerId = req.user?.id || null;
      const post = await PostService.getPostById(postId, viewerId);

      if (!post) {
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      res.json({ success: true, data: post });
    } catch (error) {
      console.error("Error in getPost:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  // ==================== GET USER POST COUNT ====================
  getUserPostCount: async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      if (!userId) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid user ID" });
      }

      const viewerId = req.user?.id; // FIX: use req.user?.id
      if (!viewerId) {
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });
      }

      const count = await PostService.getUserPostCount(userId);
      res.json({ success: true, data: { post_count: count } });
    } catch (error) {
      console.error("Error in getUserPostCount:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  // ==================== GET USER POSTS ====================
  getUserPosts: async (req, res) => {
    try {
      const schema = Joi.object({
        userId: Joi.number().integer().positive().required(),
        limit: Joi.number().integer().min(1).max(100).default(20),
        offset: Joi.number().integer().min(0).default(0),
      });

      const { error, value } = schema.validate({
        userId: parseInt(req.params.id),
        limit: parseInt(req.query.limit),
        offset: parseInt(req.query.offset),
      });

      if (error) {
        return res
          .status(400)
          .json({ success: false, message: error.details[0].message });
      }

      const viewerId = req.user?.id; // FIX: use req.user?.id
      if (!viewerId) {
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });
      }

      const result = await PostService.getUserPosts(
        value.userId,
        viewerId,
        value.limit,
        value.offset,
      );

      res.json({
        success: true,
        data: result.data,
        total_count: result.total_count,
        has_more: result.has_more,
      });
    } catch (error) {
      console.error("Error in getUserPosts:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  // ==================== GET FEED POSTS ====================
  getFeedPosts: async (req, res) => {
    try {
      const schema = Joi.object({
        limit: Joi.number().integer().min(1).max(50).default(15),
        filter: Joi.string()
          .valid(
            "all",
            "friends",
            "videos",
            "photos",
            "audio",
            "articles",
            "products",
            "jobs",
            "polls",
            "colored",
            "live",
            "links",
          )
          .default("all"),
        last_post_time: Joi.string().isoDate().allow(null),
        last_post_id: Joi.number().integer().allow(null),
      });

      const { error, value } = schema.validate(req.query);
      if (error) {
        return res.status(400).json({
          success: false,
          message: `Validation error: ${error.details[0].message}`,
        });
      }

      const viewerId = req.user?.id; // FIX: use req.user?.id
      if (!viewerId) {
        return res
          .status(401)
          .json({ success: false, message: "Authentication required" });
      }

      const result = await PostService.getFeedPosts(
        viewerId,
        value.limit,
        value.last_post_time || null,
        value.last_post_id || null,
        value.filter,
      );

      return res.json({
        success: true,
        data: {
          posts: result.data,
          pagination: {
            has_more: result.has_more,
            next_cursor: result.next_cursor,
          },
          filter: value.filter,
        },
      });
    } catch (error) {
      console.error("Error in getFeedPosts:", error);
      return res
        .status(500)
        .json({ success: false, message: "Unable to fetch feed posts" });
    }
  },

  // ==================== GET FEED FILTERS ====================
  getFeedFilters: async (req, res) => {
    try {
      const filters = [
        { key: "all", label: "All Posts", icon: "🌐" },
        { key: "friends", label: "Friends", icon: "👥" },
        { key: "videos", label: "Videos", icon: "🎥" },
        { key: "photos", label: "Photos", icon: "🖼️" },
        { key: "audio", label: "Audio", icon: "🎵" },
        { key: "links", label: "Links", icon: "🔗" },
        { key: "articles", label: "Articles", icon: "📝" },
        { key: "products", label: "Products", icon: "🛒" },
        { key: "jobs", label: "Jobs", icon: "💼" },
        { key: "polls", label: "Polls", icon: "📊" },
        { key: "colored", label: "Colored Posts", icon: "🎨" },
        { key: "live", label: "Live", icon: "🔴" },
      ];

      res.json({ success: true, data: { filters } });
    } catch (error) {
      console.error("Error in getFeedFilters:", error);
      res
        .status(500)
        .json({ success: false, message: "Unable to fetch feed filters" });
    }
  },

  // ==================== RECORD POST VIEW ====================
  recordPostView: async (req, res) => {
    try {
      const postId = parseInt(req.params.postId);
      if (!postId) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid post ID" });
      }

      const viewerId = req.user?.id; // FIX: use req.user?.id
      const guestIp = viewerId ? null : req.ip;

      const pointsAdded = await PostService.recordPostView(
        postId,
        viewerId,
        guestIp,
      );

      res.json({
        success: true,
        message: pointsAdded
          ? `View recorded and ${POINTS_CONFIG.ACTIVITIES.POST_VIEWED} points added!`
          : "View recorded (no duplicate)",
      });
    } catch (error) {
      console.error("Error in recordPostView:", error);
      res
        .status(500)
        .json({ success: false, message: "Failed to record view" });
    }
  },

  // ==================== GET POST COMMENTS ====================
  getPostComments: async (req, res) => {
    const connection = await db.getConnection();
    try {
      const postId = parseInt(req.params.id, 10);
      const viewerId = req.user?.id || null; // FIX: use req.user?.id

      const limit = Math.min(
        Math.max(parseInt(req.query.limit || "20", 10), 1),
        200,
      );
      const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);
      const sort = (req.query.sort || "oldest").toLowerCase();

      if (!postId) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid post ID" });
      }

      let rootOrderBy;
      if (sort === "newest") {
        rootOrderBy = "c.time DESC";
      } else if (sort === "top") {
        rootOrderBy = "COALESCE(rc.reaction_count, 0) DESC, c.time DESC";
      } else {
        rootOrderBy = "c.time ASC";
      }

      const rootsSql = `
        SELECT 
          c.comment_id, c.user_id, c.text, c.time, c.image, c.voice_note,
          COALESCE(rc.reaction_count, 0) AS reaction_count,
          u.user_firstname AS user_name, u.user_picture AS avatar, u.user_name AS username
        FROM posts_comments c
        LEFT JOIN (
          SELECT comment_id, COUNT(*) AS reaction_count
          FROM posts_comments_reactions
          GROUP BY comment_id
        ) rc ON rc.comment_id = c.comment_id
        LEFT JOIN users u ON u.user_id = c.user_id
        WHERE c.node_type = 'post' AND c.node_id = ?
        ORDER BY ${rootOrderBy}
        LIMIT ? OFFSET ?
      `;

      const [rootRows] = await connection.query(rootsSql, [
        postId,
        limit,
        offset,
      ]);

      if (!rootRows || rootRows.length === 0) {
        const [[{ root_count }]] = await connection.query(
          `SELECT COUNT(*) AS root_count FROM posts_comments WHERE node_type = 'post' AND node_id = ?`,
          [postId],
        );

        const [[{ total_comments }]] = await connection.query(
          `SELECT COUNT(*) AS total_comments FROM posts_comments WHERE 
            (node_type = 'post' AND node_id = ?)
            OR (node_type = 'comment' AND node_id IN (SELECT comment_id FROM posts_comments WHERE node_type = 'post' AND node_id = ?))`,
          [postId, postId],
        );

        return res.json({
          success: true,
          data: [],
          meta: {
            root_count: Number(root_count || 0),
            total_comments: Number(total_comments || 0),
          },
        });
      }

      const rootCommentIds = rootRows.map((r) => r.comment_id);

      const treeSql = `
        WITH RECURSIVE comment_tree AS (
          SELECT 
            comment_id, node_id, node_type, user_id, text, time, image, voice_note,
            0 as level
          FROM posts_comments 
          WHERE comment_id IN (?)
          
          UNION ALL
          
          SELECT 
            pc.comment_id, pc.node_id, pc.node_type, pc.user_id, pc.text, pc.time, pc.image, pc.voice_note,
            ct.level + 1 as level
          FROM posts_comments pc
          INNER JOIN comment_tree ct ON pc.node_type = 'comment' AND pc.node_id = ct.comment_id
        )
        SELECT 
          ct.comment_id, ct.node_id, ct.node_type, ct.user_id, ct.text, ct.time, ct.image, ct.voice_note, ct.level,
          u.user_firstname AS user_name, u.user_picture AS avatar, u.user_name AS username
        FROM comment_tree ct
        LEFT JOIN users u ON u.user_id = ct.user_id
        ORDER BY ct.time ASC
      `;

      const [treeRows] = await connection.query(treeSql, [rootCommentIds]);

      const commentIds = Array.from(new Set(treeRows.map((r) => r.comment_id)));

      const [reactionsRows] = await connection.query(
        `SELECT comment_id, reaction, COUNT(*) AS cnt
         FROM posts_comments_reactions
         WHERE comment_id IN (?)
         GROUP BY comment_id, reaction`,
        [commentIds],
      );

      let viewerReactionsMap = {};
      if (viewerId) {
        const [viewerRows] = await connection.query(
          `SELECT comment_id, reaction
           FROM posts_comments_reactions
           WHERE user_id = ? AND comment_id IN (?)`,
          [viewerId, commentIds],
        );
        viewerRows.forEach((v) => {
          viewerReactionsMap[v.comment_id] = v.reaction;
        });
      }

      const reactionMap = {};
      reactionsRows.forEach((r) => {
        reactionMap[r.comment_id] = reactionMap[r.comment_id] || {};
        reactionMap[r.comment_id][r.reaction] = Number(r.cnt);
      });

      const commentMap = {};
      treeRows.forEach((r) => {
        commentMap[r.comment_id] = {
          comment_id: r.comment_id,
          user_id: r.user_id,
          user_name: r.user_name,
          username: r.username,
          avatar: r.avatar,
          text: r.text,
          image: r.image,
          voice_note: r.voice_note,
          time: r.time,
          node_type: r.node_type,
          node_id: r.node_id,
          parent_id: r.node_type === "comment" ? r.node_id : null,
          level: r.level,
          reactions: reactionMap[r.comment_id] || {},
          viewer_reaction: viewerReactionsMap[r.comment_id] || null,
          replies: [],
        };
      });

      const rootComments = [];
      Object.values(commentMap).forEach((c) => {
        if (c.parent_id && commentMap[c.parent_id]) {
          commentMap[c.parent_id].replies.push(c);
        } else if (c.level === 0) {
          rootComments.push(c);
        }
      });

      const [[{ root_count }]] = await connection.query(
        `SELECT COUNT(*) AS root_count FROM posts_comments WHERE node_type = 'post' AND node_id = ?`,
        [postId],
      );

      const [[{ total_comments }]] = await connection.query(
        `SELECT COUNT(*) AS total_comments FROM posts_comments WHERE 
          (node_type = 'post' AND node_id = ?)
          OR (node_type = 'comment' AND node_id IN (SELECT comment_id FROM posts_comments WHERE node_type = 'post' AND node_id = ?))`,
        [postId, postId],
      );

      res.json({
        success: true,
        data: rootComments,
        meta: {
          root_count: Number(root_count || 0),
          total_comments: Number(total_comments || 0),
          returned_root_count: rootComments.length,
          limit,
          offset,
          sort,
        },
      });
    } catch (err) {
      console.error("getPostComments error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    } finally {
      connection.release();
    }
  },

  // ==================== CREATE COMMENT ====================
  createComment: async (req, res) => {
    const connection = await db.getConnection();
    await connection.beginTransaction();

    const verifyCommentChainBelongsToPost = async (
      conn,
      commentId,
      targetPostId,
    ) => {
      let currentId = commentId;
      let maxDepth = 10;

      while (maxDepth-- > 0) {
        const [rows] = await conn.query(
          `SELECT node_id, node_type FROM posts_comments WHERE comment_id = ?`,
          [currentId],
        );

        if (rows.length === 0) return false;

        const comment = rows[0];
        if (comment.node_type === "post") {
          return comment.node_id === targetPostId;
        }

        currentId = comment.node_id;
      }

      return false;
    };

    try {
      const postId = parseInt(req.params.id, 10);
      const userId = req.user?.id; // FIX: use req.user?.id

      if (!postId || isNaN(postId)) {
        await connection.rollback();
        return res
          .status(400)
          .json({ success: false, message: "Invalid post ID" });
      }

      if (!userId) {
        await connection.rollback();
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });
      }

      const [postCheck] = await connection.query(
        "SELECT 1 FROM posts WHERE post_id = ?",
        [postId],
      );
      if (postCheck.length === 0) {
        await connection.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      let text = (req.body.text || "").trim();
      let node_id = postId;
      let node_type = "post";

      if (req.body.parent_id) {
        const parentId = parseInt(req.body.parent_id);

        if (isNaN(parentId)) {
          await connection.rollback();
          return res
            .status(400)
            .json({ success: false, message: "Invalid parent comment ID" });
        }

        const [parentCheck] = await connection.query(
          `SELECT comment_id, node_id, node_type FROM posts_comments WHERE comment_id = ?`,
          [parentId],
        );

        if (parentCheck.length === 0) {
          await connection.rollback();
          return res
            .status(400)
            .json({ success: false, message: "Parent comment not found" });
        }

        const parentComment = parentCheck[0];

        if (
          parentComment.node_type === "post" &&
          parentComment.node_id !== postId
        ) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message: "Cannot reply to a comment from a different post",
          });
        }

        if (parentComment.node_type === "comment") {
          const isValidChain = await verifyCommentChainBelongsToPost(
            connection,
            parentId,
            postId,
          );
          if (!isValidChain) {
            await connection.rollback();
            return res.status(400).json({
              success: false,
              message:
                "Invalid reply chain – comment does not belong to this post",
            });
          }
        }

        node_id = parentId;
        node_type = "comment";
      }

      let imageUrl = null;
      if (req.file) {
        const uploadResult = await uploadToGoogleCloud(req.file, "comments");
        imageUrl = uploadResult.url;
      }

      if (!text && !imageUrl) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: "Comment must contain text or an image",
        });
      }

      const [result] = await connection.query(
        `INSERT INTO posts_comments (node_id, node_type, user_id, user_type, text, image, time) VALUES (?, ?, ?, 'user', ?, ?, NOW())`,
        [node_id, node_type, userId, text, imageUrl],
      );

      await connection.query(
        "UPDATE posts SET comments = comments + 1 WHERE post_id = ?",
        [postId],
      );

      // ✅ Add points for commenting
      await PointsService.addPoints(
        userId,
        POINTS_CONFIG.ACTIVITIES.COMMENT_CREATED,
        "comment_created",
        result.insertId,
        `Commented on post ${postId}`,
      );

      await connection.commit();

      res.status(201).json({
        success: true,
        message: "Comment posted successfully",
        data: { comment_id: result.insertId },
      });
    } catch (error) {
      await connection.rollback();
      console.error("Error creating comment:", error);
      res.status(500).json({
        success: false,
        message: "Failed to post comment",
        error: error.message,
      });
    } finally {
      connection.release();
    }
  },

  // ==================== ADD COMMENT (alias used by router) ====================
  addComment: async (req, res) => {
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      const postId = parseInt(req.params.id); // FIX: use req.params.id
      const userId = req.user?.id; // FIX: use req.user?.id

      if (!postId) {
        await connection.rollback();
        return res
          .status(400)
          .json({ success: false, message: "Invalid post ID" });
      }

      if (!userId) {
        await connection.rollback();
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });
      }

      const [postCheck] = await connection.query(
        "SELECT 1 FROM posts WHERE post_id = ?",
        [postId],
      );
      if (postCheck.length === 0) {
        await connection.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      const text = req.body.text?.trim() || "";
      const parent_comment_id = req.body.parent_id
        ? parseInt(req.body.parent_id)
        : null;
      const voice_note = req.body.voice_note || null;

      let imageUrl = null;
      if (req.file) {
        const uploadResult = await uploadToGoogleCloud(req.file, "comments");
        imageUrl = uploadResult.url;
      }

      if (!text && !imageUrl) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: "Comment must contain text or an image",
        });
      }

      const nodeType = parent_comment_id ? "comment" : "post";
      const nodeId = parent_comment_id || postId;

      const [result] = await connection.query(
        `INSERT INTO posts_comments (node_id, node_type, user_id, user_type, text, image, voice_note, time) VALUES (?, ?, ?, 'user', ?, ?, ?, NOW())`,
        [nodeId, nodeType, userId, text, imageUrl, voice_note],
      );

      if (!parent_comment_id) {
        await connection.query(
          `UPDATE posts SET comments = comments + 1 WHERE post_id = ?`,
          [postId],
        );
      } else {
        await connection.query(
          `UPDATE posts_comments SET replies = replies + 1 WHERE comment_id = ?`,
          [parent_comment_id],
        );
      }

      // ✅ Add points for commenting
      await PointsService.addPoints(
        userId,
        POINTS_CONFIG.ACTIVITIES.COMMENT_CREATED,
        "comment_created",
        result.insertId,
        `Commented on post ${postId}`,
      );

      await connection.commit();

      const [comment] = await connection.query(
        `SELECT pc.*, u.user_name, u.user_firstname, u.user_lastname, u.user_picture
         FROM posts_comments pc
         LEFT JOIN users u ON pc.user_id = u.user_id
         WHERE pc.comment_id = ?`,
        [result.insertId],
      );

      res.json({
        success: true,
        message: "Comment added successfully",
        data: comment[0],
      });
    } catch (error) {
      await connection.rollback();
      console.error("Add comment error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to add comment",
      });
    } finally {
      connection.release();
    }
  },

  // ==================== GET COMMENTS ====================
  getComments: async (req, res) => {
    try {
      const postId = parseInt(req.params.id); // FIX: use req.params.id
      const { limit = 20, offset = 0 } = req.query;
      const user_id = req.user?.id; // FIX: use req.user?.id

      const [comments] = await db.query(
        `SELECT pc.*, 
          u.user_name, u.user_firstname, u.user_lastname, u.user_picture,
          COUNT(DISTINCT pcr.id) as reactions_count,
          pc.replies as replies_count,
          (SELECT reaction FROM posts_comments_reactions 
           WHERE comment_id = pc.comment_id AND user_id = ?) as user_reaction
         FROM posts_comments pc
         LEFT JOIN users u ON pc.user_id = u.user_id
         LEFT JOIN posts_comments_reactions pcr ON pc.comment_id = pcr.comment_id
         WHERE pc.node_id = ? AND pc.node_type = 'post'
         GROUP BY pc.comment_id
         ORDER BY pc.time ASC
         LIMIT ? OFFSET ?`,
        [user_id, postId, parseInt(limit), parseInt(offset)],
      );

      const [total] = await db.query(
        `SELECT COUNT(*) as total FROM posts_comments WHERE node_id = ? AND node_type = 'post'`,
        [postId],
      );

      res.json({
        success: true,
        data: comments,
        total: total[0].total,
        has_more: offset + comments.length < total[0].total,
      });
    } catch (error) {
      console.error("Get comments error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to get comments",
      });
    }
  },

  // ==================== REACT TO COMMENT ====================
  reactToComment: async (req, res) => {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const comment_id = parseInt(req.params.commentId); // FIX: use req.params.commentId
      const { reaction } = req.body;
      const user_id = req.user?.id; // FIX: use req.user?.id

      const [existing] = await connection.query(
        `SELECT id FROM posts_comments_reactions WHERE comment_id = ? AND user_id = ?`,
        [comment_id, user_id],
      );

      if (existing.length > 0) {
        await connection.query(
          `DELETE FROM posts_comments_reactions WHERE id = ?`,
          [existing[0].id],
        );
      } else {
        await connection.query(
          `INSERT INTO posts_comments_reactions (comment_id, user_id, reaction, reaction_time) VALUES (?, ?, ?, NOW())`,
          [comment_id, user_id, reaction],
        );
      }

      const [count] = await connection.query(
        `SELECT COUNT(*) as count FROM posts_comments_reactions WHERE comment_id = ?`,
        [comment_id],
      );

      await connection.commit();

      res.json({
        success: true,
        reacted: existing.length === 0,
        reactions_count: count[0].count,
      });
    } catch (error) {
      await connection.rollback();
      console.error("React to comment error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to react to comment",
      });
    } finally {
      connection.release();
    }
  },

  // ==================== DELETE COMMENT ====================
  deleteComment: async (req, res) => {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const comment_id = parseInt(req.params.commentId); // FIX: use req.params.commentId
      const user_id = req.user?.id; // FIX: use req.user?.id

      const [comment] = await connection.query(
        `SELECT * FROM posts_comments WHERE comment_id = ? AND user_id = ?`,
        [comment_id, user_id],
      );

      if (comment.length === 0) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message:
            "Comment not found or you don't have permission to delete it",
        });
      }

      if (comment[0].node_type === "post") {
        await connection.query(
          `UPDATE posts SET comments = GREATEST(comments - 1, 0) WHERE post_id = ?`,
          [comment[0].node_id],
        );
      } else if (comment[0].node_type === "comment") {
        await connection.query(
          `UPDATE posts_comments SET replies = GREATEST(replies - 1, 0) WHERE comment_id = ?`,
          [comment[0].node_id],
        );
      }

      await connection.query(
        `DELETE FROM posts_comments WHERE comment_id = ?`,
        [comment_id],
      );

      await connection.commit();

      res.json({ success: true, message: "Comment deleted successfully" });
    } catch (error) {
      await connection.rollback();
      console.error("Delete comment error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to delete comment",
      });
    } finally {
      connection.release();
    }
  },

  // ==================== VOTE ON POLL (old endpoint kept for compatibility) ====================
  voteOnPoll: async (req, res) => {
    try {
      const postId = req.params.id; // FIX: use req.params.id
      const { option_id = null } = req.body;
      const userId = req.user?.id; // FIX: use req.user?.id

      const [poll] = await db.query(
        "SELECT poll_id FROM posts_polls WHERE post_id = ?",
        [postId],
      );

      if (!poll.length) {
        return res
          .status(404)
          .json({ success: false, message: "Poll not found" });
      }

      const pollId = poll[0].poll_id;

      await db.query(
        "DELETE FROM posts_polls_options_users WHERE poll_id = ? AND user_id = ?",
        [pollId, userId],
      );

      if (option_id) {
        await db.query(
          `INSERT INTO posts_polls_options_users (poll_id, option_id, user_id)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE option_id = ?`,
          [pollId, option_id, userId, option_id],
        );
      }

      await db.query(
        `UPDATE posts_polls_options po
         SET votes = (SELECT COUNT(*) FROM posts_polls_options_users pou WHERE pou.option_id = po.option_id)
         WHERE po.poll_id = ?`,
        [pollId],
      );

      const [[{ total }]] = await db.query(
        `SELECT COUNT(*) as total FROM posts_polls_options_users WHERE poll_id = ?`,
        [pollId],
      );

      await db.query("UPDATE posts_polls SET votes = ? WHERE poll_id = ?", [
        total,
        pollId,
      ]);

      res.json({ success: true });
    } catch (err) {
      console.error("Vote on poll error:", err);
      res.status(500).json({ success: false, message: "Vote failed" });
    }
  },

  // ==================== VOTE IN POLL (PostService version) ====================
  voteInPoll: async (req, res) => {
    try {
      const postId = req.params.id; // FIX: use req.params.id
      const { option_id = null } = req.body;
      const userId = req.user?.id; // FIX: use req.user?.id

      if (!option_id) {
        return res
          .status(400)
          .json({ success: false, message: "Option ID is required" });
      }

      // Get poll_id from post_id
      const [poll] = await db.query(
        "SELECT poll_id FROM posts_polls WHERE post_id = ?",
        [postId],
      );

      if (!poll.length) {
        return res
          .status(404)
          .json({ success: false, message: "Poll not found" });
      }

      const result = await PostService.voteInPoll({
        pollId: poll[0].poll_id,
        optionId: option_id,
        userId,
      });

      res.json(result);
    } catch (error) {
      console.error("Vote in poll error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to vote in poll",
      });
    }
  },

  // ==================== GET POLL ====================
  getPoll: async (req, res) => {
    try {
      const postId = req.params.id; // FIX: use req.params.id
      const userId = req.user?.id || 0; // FIX: use req.user?.id

      const [options] = await db.query(
        `SELECT 
          po.option_id,
          po.text,
          po.votes,
          pou.user_id IS NOT NULL AS voted
         FROM posts_polls_options po
         LEFT JOIN posts_polls_options_users pou 
           ON pou.option_id = po.option_id AND pou.user_id = ?
         WHERE po.poll_id = (SELECT poll_id FROM posts_polls WHERE post_id = ?)
         ORDER BY po.option_id`,
        [userId, postId],
      );

      const userVote = options.find((o) => o.voted)?.option_id || null;

      res.json({
        success: true,
        options: options.map((o) => ({
          option_id: o.option_id,
          text: o.text,
          votes: Number(o.votes),
        })),
        user_vote: userVote,
      });
    } catch (error) {
      console.error("Get poll error:", error);
      res.status(500).json({ success: false, message: "Failed to get poll" });
    }
  },

  // ==================== GET POLL RESULTS ====================
  getPollResults: async (req, res) => {
    try {
      const postId = req.params.id; // FIX: use req.params.id
      const user_id = req.user?.id; // FIX: use req.user?.id

      // Get poll_id from post_id first
      const [poll] = await db.query(
        "SELECT poll_id FROM posts_polls WHERE post_id = ?",
        [postId],
      );

      if (!poll.length) {
        return res
          .status(404)
          .json({ success: false, message: "Poll not found" });
      }

      const result = await PostService.getPollResults(poll[0].poll_id, user_id);
      res.json(result);
    } catch (error) {
      console.error("Get poll results error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to get poll results",
      });
    }
  },

  // ==================== APPLY FOR JOB ====================
  applyForJob: async (req, res) => {
    try {
      const post_id = req.params.id; // FIX: use req.params.id (router uses /:id)
      const user_id = req.user?.id; // FIX: use req.user?.id
      const applicationData = JSON.parse(req.body.application_data || "{}");

      let cvFile = null;
      if (req.file) {
        cvFile = req.file;
      }

      const result = await PostService.applyForJob({
        postId: post_id,
        userId: user_id,
        applicationData,
        cvFile,
      });

      res.json(result);
    } catch (error) {
      console.error("Apply for job error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to apply for job",
      });
    }
  },

  // ==================== GET JOB APPLICATIONS ====================
  getJobApplications: async (req, res) => {
    try {
      const post_id = req.params.id; // FIX: use req.params.id
      const user_id = req.user?.id; // FIX: use req.user?.id

      const result = await PostService.getJobApplications(post_id, user_id);
      res.json(result);
    } catch (error) {
      console.error("Get job applications error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to get job applications",
      });
    }
  },

  // ==================== DONATE TO FUNDING ====================
  donateToFunding: async (req, res) => {
    try {
      const post_id = req.params.id;
      const { amount } = req.body;
      const user_id = req.user?.id;

      if (!amount || amount <= 0) {
        return res
          .status(400)
          .json({ success: false, message: "Valid amount is required" });
      }

      const [user] = await db.query(
        "SELECT user_wallet_balance FROM users WHERE user_id = ?",
        [user_id],
      );

      const result = await PostService.donateToFunding({
        postId: post_id,
        userId: user_id,
        amount: parseFloat(amount),
        walletBalance: user[0]?.user_wallet_balance || 0,
      });

      // Get the updated post data to return
      const updatedPost = await PostService.getPostById(post_id, user_id);

      res.json({
        success: true,
        message: result.message,
        data: {
          donation: result.donation,
          funding: updatedPost?.funding || result.funding,
        },
      });
    } catch (error) {
      console.error("Donate to funding error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to donate",
      });
    }
  },

  // ==================== GET FUNDING DONORS ====================
  getFundingDonors: async (req, res) => {
    try {
      const post_id = req.params.id; // FIX: use req.params.id
      const { limit = 20, offset = 0 } = req.query;

      const result = await PostService.getFundingDonors(
        post_id,
        parseInt(limit),
        parseInt(offset),
      );
      res.json(result);
    } catch (error) {
      console.error("Get funding donors error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to get donors",
      });
    }
  },

  // ==================== PURCHASE PRODUCT ====================
  purchaseProduct: async (req, res) => {
    try {
      const post_id = req.params.id; // FIX: use req.params.id
      const { quantity = 1, address_id } = req.body;
      const user_id = req.user?.id; // FIX: use req.user?.id

      const result = await PostService.purchaseProduct({
        postId: post_id,
        userId: user_id,
        quantity: parseInt(quantity),
        addressId: address_id,
      });

      res.json(result);
    } catch (error) {
      console.error("Purchase product error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to purchase product",
      });
    }
  },

  // ==================== REACT TO POST ====================
  reactToPost: async (req, res) => {
    try {
      const post_id = req.params.id; // FIX: use req.params.id
      const { reaction } = req.body;
      const user_id = req.user?.id; // FIX: use req.user?.id

      if (!reaction) {
        return res
          .status(400)
          .json({ success: false, message: "Reaction type is required" });
      }

      const result = await PostService.reactToPost({
        postId: post_id,
        userId: user_id,
        reaction,
      });

      res.json(result);
    } catch (error) {
      console.error("React to post error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to react to post",
      });
    }
  },

  // ==================== SAVE POST ====================
  savePost: async (req, res) => {
    try {
      const post_id = req.params.id; // FIX: use req.params.id
      const user_id = req.user?.id; // FIX: use req.user?.id

      const result = await PostService.savePost({
        postId: post_id,
        userId: user_id,
      });
      res.json(result);
    } catch (error) {
      console.error("Save post error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to save post",
      });
    }
  },

  // ==================== SHARE POST ====================
  sharePost: async (req, res) => {
    try {
      const post_id = req.params.id; // FIX: use req.params.id
      const { text, privacy = "public" } = req.body;
      const user_id = req.user?.id; // FIX: use req.user?.id

      const result = await PostService.sharePost({
        postId: post_id,
        userId: user_id,
        userType: "user",
        text,
        privacy,
      });

      res.json(result);
    } catch (error) {
      console.error("Share post error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to share post",
      });
    }
  },

  // ==================== GET OFFER CATEGORIES ====================
  getOfferCategories: async (req, res) => {
    try {
      const [categories] = await db.query(
        `SELECT category_id, category_name, category_parent_id 
       FROM offers_categories 
       ORDER BY category_order ASC, category_name ASC`,
      );
      res.json({ success: true, data: categories });
    } catch (error) {
      console.error("Get offer categories error:", error);
      res
        .status(500)
        .json({ success: false, message: "Failed to fetch offer categories" });
    }
  },

  // ==================== DELETE POST ====================
  deletePost: async (req, res) => {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const postId = parseInt(req.params.id);
      const userId = req.user?.id;

      if (!postId) {
        await connection.rollback();
        return res
          .status(400)
          .json({ success: false, message: "Invalid post ID" });
      }

      if (!userId) {
        await connection.rollback();
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });
      }

      // Check post exists and belongs to user
      const [post] = await connection.query(
        `SELECT post_id, post_type, user_id FROM posts WHERE post_id = ? AND user_id = ?`,
        [postId, userId],
      );

      if (post.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "Post not found or you don't have permission to delete it",
        });
      }

      // Delete related data
      await connection.query(`DELETE FROM posts_photos WHERE post_id = ?`, [
        postId,
      ]);
      await connection.query(`DELETE FROM posts_videos WHERE post_id = ?`, [
        postId,
      ]);
      await connection.query(`DELETE FROM posts_audios WHERE post_id = ?`, [
        postId,
      ]);
      await connection.query(`DELETE FROM posts_files WHERE post_id = ?`, [
        postId,
      ]);
      await connection.query(`DELETE FROM posts_links WHERE post_id = ?`, [
        postId,
      ]);
      await connection.query(`DELETE FROM posts_articles WHERE post_id = ?`, [
        postId,
      ]);
      await connection.query(
        `DELETE FROM posts_polls_options_users WHERE poll_id IN (SELECT poll_id FROM posts_polls WHERE post_id = ?)`,
        [postId],
      );
      await connection.query(
        `DELETE FROM posts_polls_options WHERE poll_id IN (SELECT poll_id FROM posts_polls WHERE post_id = ?)`,
        [postId],
      );
      await connection.query(`DELETE FROM posts_polls WHERE post_id = ?`, [
        postId,
      ]);
      await connection.query(`DELETE FROM posts_jobs WHERE post_id = ?`, [
        postId,
      ]);
      await connection.query(`DELETE FROM posts_products WHERE post_id = ?`, [
        postId,
      ]);
      await connection.query(
        `DELETE FROM posts_funding_donors WHERE post_id = ?`,
        [postId],
      );
      await connection.query(`DELETE FROM posts_funding WHERE post_id = ?`, [
        postId,
      ]);
      await connection.query(`DELETE FROM posts_live WHERE post_id = ?`, [
        postId,
      ]);
      await connection.query(`DELETE FROM posts_offers WHERE post_id = ?`, [
        postId,
      ]);
      await connection.query(`DELETE FROM posts_reactions WHERE post_id = ?`, [
        postId,
      ]);
      await connection.query(`DELETE FROM posts_saved WHERE post_id = ?`, [
        postId,
      ]);
      await connection.query(`DELETE FROM posts_views WHERE post_id = ?`, [
        postId,
      ]);
      await connection.query(
        `DELETE FROM posts_comments_reactions WHERE comment_id IN (SELECT comment_id FROM posts_comments WHERE node_id = ? AND node_type = 'post')`,
        [postId],
      );
      await connection.query(
        `DELETE FROM posts_comments WHERE node_id = ? AND node_type = 'post'`,
        [postId],
      );

      // Delete the post itself
      await connection.query(`DELETE FROM posts WHERE post_id = ?`, [postId]);

      await connection.commit();

      res.json({ success: true, message: "Post deleted successfully" });
    } catch (error) {
      await connection.rollback();
      console.error("Delete post error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to delete post",
      });
    } finally {
      connection.release();
    }
  },

  // ==================== GET COLORED PATTERNS ====================
  getColoredPatterns: async (req, res) => {
    try {
      const patterns = await PostService.getColoredPatterns();
      res.json({
        success: true,
        data: patterns,
      });
    } catch (error) {
      console.error("Error fetching colored patterns:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch colored patterns",
      });
    }
  },

  // ==================== REPORT POST ====================
  reportPost: async (req, res) => {
    try {
      const { post_id, reason } = req.body;
      const userId = req.user.id;

      if (!post_id) {
        return res.status(400).json({
          success: false,
          message: "Post ID is required",
        });
      }

      const reportReason = reason || "User reported content";

      // Store report in database (assuming you have a reports table)
      const query = `
        INSERT INTO post_reports (post_id, reported_by, reason, created_at)
        VALUES (?, ?, ?, NOW())
      `;

      await db.query(query, [post_id, userId, reportReason]);

      // Send email to admin
      const nodemailer = require("nodemailer");
      const transporter = nodemailer.createTransport({
        service: process.env.EMAIL_SERVICE || "gmail",
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASSWORD,
        },
      });

      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: "admin@pipiafrica.com",
        subject: "Post Report",
        html: `
          <h2>New Post Report</h2>
          <p><strong>Post ID:</strong> ${post_id}</p>
          <p><strong>Reported By:</strong> User ID ${userId}</p>
          <p><strong>Reason:</strong> ${reportReason}</p>
          <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
        `,
      };

      // Send email asynchronously without blocking the response
      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error("Error sending report email:", error);
        } else {
          console.log("Report email sent:", info.response);
        }
      });

      res.status(200).json({
        success: true,
        message: "Post reported successfully. Our team will review it.",
      });
    } catch (error) {
      console.error("Error reporting post:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to report post",
      });
    }
  },
};

module.exports = postController;
