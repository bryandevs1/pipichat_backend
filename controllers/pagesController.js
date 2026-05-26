const pool = require("../config/db");
const { logActivity } = require("../services/activityLogger");
const PostService = require("../services/Postservice");
const { sendEmail } = require("../utils/email");
const storageManager = require("../utils/storageManager");
const path = require("path");
const PostController = require("./createPostController");
const fs = require("fs").promises;

// Custom Errors
class PageError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
  }
}

class PageNotFoundError extends PageError {
  constructor(message = "Page not found") {
    super(message, 404);
  }
}

class UnauthorizedPageError extends PageError {
  constructor(message = "Unauthorized access") {
    super(message, 403);
  }
}

class ValidationPageError extends PageError {
  constructor(message = "Validation failed") {
    super(message, 400);
  }
}

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

class PagesController {
  // Helper: Get current user ID
  static getCurrentUserId(req) {
    return (
      req.user?.id ||
      req.user?.user_id ||
      req.user?.uid ||
      req.userId ||
      (req.headers.authorization
        ? req.headers.authorization.split(" ")[1]
        : null) ||
      null
    );
  }

  // Helper: Check if user is page admin
  static async isUserAdmin(pageId, userId) {
    if (!userId) return false;
    const [admin] = await pool.query(
      `SELECT 1 FROM pages_admins 
       WHERE page_id = ? AND user_id = ?`,
      [pageId, userId],
    );
    return admin.length > 0;
  }

  // Helper: Check if user is page owner/creator
  static async isUserCreator(pageId, userId) {
    const [page] = await pool.query(
      "SELECT page_admin FROM pages WHERE page_id = ?",
      [pageId],
    );
    return page.length > 0 && page[0].page_admin === userId;
  }

  // Helper: Check if user likes the page
  static async isUserLiked(pageId, userId) {
    if (!userId) return false;
    const [like] = await pool.query(
      `SELECT 1 FROM pages_likes 
       WHERE page_id = ? AND user_id = ?`,
      [pageId, userId],
    );
    return like.length > 0;
  }

  // Helper: Check if user is invited to page
  static async isUserInvited(pageId, userId) {
    if (!userId) return false;
    const [invite] = await pool.query(
      `SELECT 1 FROM pages_invites 
       WHERE page_id = ? AND user_id = ?`,
      [pageId, userId],
    );
    return invite.length > 0;
  }

  // Helper: Handle file upload
  static async handleFileUpload(file, folder) {
    if (!file) return null;

    try {
      if (!file.originalname) {
        file.originalname = `file-${Date.now()}.jpg`;
      }

      const result = await storageManager.upload(file, folder);
      return result;
    } catch (error) {
      console.error("File upload error:", error);
      throw new ValidationPageError(`Failed to upload file: ${error.message}`);
    }
  }

  // Helper: Delete old file
  static async deleteOldFile(storageType, path) {
    if (!storageType || !path) return;

    try {
      await storageManager.deleteFile(storageType, path);
    } catch (error) {
      console.error("Failed to delete old file:", error.message);
    }
  }

  // 1. CREATE PAGE
  static async createPage(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const userId = PagesController.getCurrentUserId(req);
      if (!userId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      const {
        page_name,
        page_title,
        page_description,
        page_category,
        page_company,
        page_phone,
        page_website,
        page_location,
        page_country, // REQUIRED - cannot be null
        page_action_text,
        page_action_color,
        page_action_url,
        page_social_facebook,
        page_social_twitter,
        page_social_youtube,
        page_social_instagram,
        page_social_linkedin,
        page_social_vkontakte,
        page_tips_enabled = "0",
        page_monetization_enabled = "0",
        page_monetization_min_price = 0,
        page_monetization_plans = 0,
      } = req.body;

      // Validate required fields
      if (!page_name?.trim()) {
        throw new ValidationPageError("Page name is required");
      }

      if (!/^[a-z0-9_-]{3,64}$/i.test(page_name)) {
        throw new ValidationPageError(
          "Page name must be 3-64 characters, alphanumeric with underscores or hyphens",
        );
      }

      if (!page_title?.trim()) {
        throw new ValidationPageError("Page title is required");
      }

      if (!page_description?.trim()) {
        throw new ValidationPageError("Page description is required");
      }

      if (!page_country) {
        throw new ValidationPageError("Country is required");
      }

      if (!page_category) {
        throw new ValidationPageError("Category is required");
      }

      // Check uniqueness
      const [existing] = await connection.query(
        "SELECT 1 FROM pages WHERE page_name = ?",
        [page_name],
      );

      if (existing.length > 0) {
        throw new ValidationPageError("Page name already taken", 409);
      }

      // Handle page picture and cover upload
      let pagePictureResult = null; // Store the full upload result
      let pageCoverResult = null; // Store the full upload result

      if (req.files) {
        if (req.files.page_picture && req.files.page_picture[0]) {
          const pictureFile = req.files.page_picture[0];
          pictureFile.originalname = `page-picture-${Date.now()}-${pictureFile.originalname}`;
          pagePictureResult = await storageManager.upload(
            pictureFile,
            "pages/page-pictures",
          );
          // No need for separate pagePicturePath variable - use result.path directly
        }

        if (req.files.page_cover && req.files.page_cover[0]) {
          const coverFile = req.files.page_cover[0];
          coverFile.originalname = `page-cover-${Date.now()}-${coverFile.originalname}`;
          pageCoverResult = await storageManager.upload(
            coverFile,
            "pages/page-covers",
          );
          // No need for separate pageCoverPath variable - use result.path directly
        }
      }

      // Create page
      const [result] = await connection.query(
        `INSERT INTO pages (
    page_admin, page_category, page_name, page_title,
    page_picture, page_cover,
    page_cover_position, page_verified, page_tips_enabled,
    page_company, page_phone, page_website, page_location,
    page_country, page_description, page_action_text,
    page_action_color, page_action_url, page_social_facebook,
    page_social_twitter, page_social_youtube, page_social_instagram,
    page_social_linkedin, page_social_vkontakte, page_likes,
    page_monetization_enabled, page_monetization_min_price,
    page_monetization_plans, page_rate, page_date
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
        [
          userId,
          page_category,
          page_name,
          page_title,
          pagePictureResult ? pagePictureResult.path : null, // Use result.path directly
          pageCoverResult ? pageCoverResult.path : null, // Use result.path directly
          req.body.page_cover_position || "center",
          "0",
          page_tips_enabled,
          page_company || null,
          page_phone || null,
          page_website || null,
          page_location || null,
          page_country,
          page_description,
          page_action_text || null,
          page_action_color || null,
          page_action_url || null,
          page_social_facebook || null,
          page_social_twitter || null,
          page_social_youtube || null,
          page_social_instagram || null,
          page_social_linkedin || null,
          page_social_vkontakte || null,
          0,
          page_monetization_enabled,
          page_monetization_min_price,
          page_monetization_plans,
          0.0,
        ],
      );

      const pageId = result.insertId;

      // Add creator as admin
      await connection.query(
        "INSERT INTO pages_admins (page_id, user_id) VALUES (?, ?)",
        [pageId, userId],
      );

      // Create default photo albums
      await connection.query(
        `INSERT INTO posts_photos_albums 
   (title, user_id, user_type, in_group, group_id, in_event, event_id, privacy) 
   VALUES 
   ('Page Pictures', ?, 'page', '0', NULL, '0', NULL, 'public'),
   ('Page Covers', ?, 'page', '0', NULL, '0', NULL, 'public'),
   ('Page Timeline', ?, 'page', '0', NULL, '0', NULL, 'public')`,
        [pageId, pageId, pageId],
      );

      // Update album IDs in pages table
      const [albums] = await connection.query(
        "SELECT album_id FROM posts_photos_albums WHERE user_id = ? AND user_type = 'page' ORDER BY album_id ASC",
        [pageId],
      );

      if (albums.length >= 3) {
        await connection.query(
          "UPDATE pages SET page_album_pictures = ?, page_album_covers = ?, page_album_timeline = ? WHERE page_id = ?",
          [albums[0].album_id, albums[1].album_id, albums[2].album_id, pageId],
        );
      }

      await connection.commit();

      // Log activity
      await logActivity(
        userId,
        "page_create",
        `Created page: ${page_title}`,
        pageId,
        "page",
      );

      res.status(201).json({
        success: true,
        message: "Page created successfully",
        data: {
          page_id: pageId,
          page_name,
          page_title,
          page_picture_url: pagePictureResult
            ? await storageManager.getPublicUrl(
                pagePictureResult.storage_type,
                pagePictureResult.path,
                pagePictureResult.storage_data,
              )
            : null,
          page_cover_url: pageCoverResult
            ? await storageManager.getPublicUrl(
                pageCoverResult.storage_type,
                pageCoverResult.path,
                pageCoverResult.storage_data,
              )
            : null,
          url: `/pages/${pageId}`,
        },
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 2. GET PAGE DETAILS
  static async getPage(req, res, next) {
    try {
      const pageId = req.params.pageId;
      const userId = PagesController.getCurrentUserId(req);

      const [pages] = await pool.query(
        `SELECT p.*, 
                pc.category_name as category_name,
                pc.category_parent_id as parent_category_id,
                sc.country_name
         FROM pages p
         LEFT JOIN pages_categories pc ON p.page_category = pc.category_id
         LEFT JOIN system_countries sc ON p.page_country = sc.country_id
         WHERE p.page_id = ?`,
        [pageId],
      );

      if (pages.length === 0) {
        throw new PageNotFoundError();
      }

      const page = pages[0];

      // Check if user is admin
      const isAdmin = await PagesController.isUserAdmin(pageId, userId);
      const isCreator = await PagesController.isUserCreator(pageId, userId);
      const isLiked = await PagesController.isUserLiked(pageId, userId);

      // Get page admins
      const [admins] = await pool.query(
        `SELECT u.user_id, u.user_name, u.user_firstname, u.user_lastname, u.user_picture, u.user_verified
         FROM pages_admins pa
         JOIN users u ON pa.user_id = u.user_id
         WHERE pa.page_id = ?`,
        [pageId],
      );

      // Get total likes count
      const [likesCount] = await pool.query(
        "SELECT COUNT(*) as total_likes FROM pages_likes WHERE page_id = ?",
        [pageId],
      );

      // Get recent posts count
      const [postsCount] = await pool.query(
        "SELECT COUNT(*) as total_posts FROM posts WHERE user_type = 'page' AND user_id = ? AND (in_group = '0' OR in_group IS NULL)",
        [pageId],
      );

      res.json({
        success: true,
        data: {
          ...page,
          is_admin: isAdmin,
          is_creator: isCreator,
          is_liked: isLiked,
          total_likes: likesCount[0]?.total_likes || 0,
          total_posts: postsCount[0]?.total_posts || 0,
          admins: admins,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 3. UPDATE PAGE
  static async updatePage(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const pageId = req.params.pageId;
      const userId = PagesController.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Check if user is admin
      const isAdmin = await PagesController.isUserAdmin(pageId, userId);
      if (!isAdmin) {
        throw new UnauthorizedPageError("Only page admins can update the page");
      }

      const {
        page_title,
        page_description,
        page_category,
        page_company,
        page_phone,
        page_website,
        page_location,
        page_country,
        page_action_text,
        page_action_color,
        page_action_url,
        page_social_facebook,
        page_social_twitter,
        page_social_youtube,
        page_social_instagram,
        page_social_linkedin,
        page_social_vkontakte,
        page_tips_enabled,
        page_monetization_enabled,
        page_monetization_min_price,
        page_cover_position,
      } = req.body;

      // Get current page data
      const [currentPage] = await connection.query(
        "SELECT page_picture, page_picture_id, page_cover, page_cover_id FROM pages WHERE page_id = ?",
        [pageId],
      );

      if (currentPage.length === 0) {
        throw new PageNotFoundError();
      }

      let pagePicturePath = null;
      let pageCoverPath = null;
      let newPagePictureId = null;
      let newPageCoverId = null;

      // Handle picture upload if provided
      if (req.files && req.files.page_picture && req.files.page_picture[0]) {
        // Delete old picture file if it exists
        if (currentPage[0].page_picture) {
          await PagesController.deleteOldFile(currentPage[0].page_picture);
        }

        const pictureFile = req.files.page_picture[0];
        pictureFile.originalname = `page-picture-${Date.now()}-${pictureFile.originalname}`;
        const pictureData = await storageManager.upload(
          pictureFile,
          "page-pictures",
        );
        pagePicturePath = pictureData.path;

        // Create new photo entry
        const [photoResult] = await connection.query(
          "INSERT INTO posts_photos (source) VALUES (?)",
          [pagePicturePath],
        );
        newPagePictureId = photoResult.insertId;
      }

      // Handle cover upload if provided
      if (req.files && req.files.page_cover && req.files.page_cover[0]) {
        // Delete old cover file if it exists
        if (currentPage[0].page_cover) {
          await PagesController.deleteOldFile(currentPage[0].page_cover);
        }

        const coverFile = req.files.page_cover[0];
        coverFile.originalname = `page-cover-${Date.now()}-${coverFile.originalname}`;
        const coverData = await storageManager.upload(coverFile, "page-covers");
        pageCoverPath = coverData.path;

        // Create new photo entry
        const [photoResult] = await connection.query(
          "INSERT INTO posts_photos (source) VALUES (?)",
          [pageCoverPath],
        );
        newPageCoverId = photoResult.insertId;
      }

      // Prepare update fields
      const updateFields = [];
      const updateValues = [];

      if (page_title !== undefined) {
        updateFields.push("page_title = ?");
        updateValues.push(page_title);
      }

      if (page_description !== undefined) {
        updateFields.push("page_description = ?");
        updateValues.push(page_description);
      }

      if (page_category !== undefined) {
        updateFields.push("page_category = ?");
        updateValues.push(page_category);
      }

      if (page_company !== undefined) {
        updateFields.push("page_company = ?");
        updateValues.push(page_company);
      }

      if (page_phone !== undefined) {
        updateFields.push("page_phone = ?");
        updateValues.push(page_phone);
      }

      if (page_website !== undefined) {
        updateFields.push("page_website = ?");
        updateValues.push(page_website);
      }

      if (page_location !== undefined) {
        updateFields.push("page_location = ?");
        updateValues.push(page_location);
      }

      if (page_country !== undefined) {
        updateFields.push("page_country = ?");
        updateValues.push(page_country);
      }

      if (page_action_text !== undefined) {
        updateFields.push("page_action_text = ?");
        updateValues.push(page_action_text);
      }

      if (page_action_color !== undefined) {
        updateFields.push("page_action_color = ?");
        updateValues.push(page_action_color);
      }

      if (page_action_url !== undefined) {
        updateFields.push("page_action_url = ?");
        updateValues.push(page_action_url);
      }

      if (page_social_facebook !== undefined) {
        updateFields.push("page_social_facebook = ?");
        updateValues.push(page_social_facebook);
      }

      if (page_social_twitter !== undefined) {
        updateFields.push("page_social_twitter = ?");
        updateValues.push(page_social_twitter);
      }

      if (page_social_youtube !== undefined) {
        updateFields.push("page_social_youtube = ?");
        updateValues.push(page_social_youtube);
      }

      if (page_social_instagram !== undefined) {
        updateFields.push("page_social_instagram = ?");
        updateValues.push(page_social_instagram);
      }

      if (page_social_linkedin !== undefined) {
        updateFields.push("page_social_linkedin = ?");
        updateValues.push(page_social_linkedin);
      }

      if (page_social_vkontakte !== undefined) {
        updateFields.push("page_social_vkontakte = ?");
        updateValues.push(page_social_vkontakte);
      }

      if (page_tips_enabled !== undefined) {
        updateFields.push("page_tips_enabled = ?");
        updateValues.push(normalizeEnum01(page_tips_enabled));
      }

      if (page_monetization_enabled !== undefined) {
        updateFields.push("page_monetization_enabled = ?");
        updateValues.push(normalizeEnum01(page_monetization_enabled));
      }

      if (page_monetization_min_price !== undefined) {
        updateFields.push("page_monetization_min_price = ?");
        updateValues.push(page_monetization_min_price);
      }

      if (page_cover_position !== undefined) {
        updateFields.push("page_cover_position = ?");
        updateValues.push(page_cover_position);
      }

      if (pagePicturePath) {
        updateFields.push("page_picture = ?, page_picture_id = ?");
        updateValues.push(pagePicturePath, newPagePictureId);
      }

      if (pageCoverPath) {
        updateFields.push("page_cover = ?, page_cover_id = ?");
        updateValues.push(pageCoverPath, newPageCoverId);
      }

      if (updateFields.length > 0) {
        updateValues.push(pageId);
        const updateQuery = `UPDATE pages SET ${updateFields.join(", ")} WHERE page_id = ?`;
        await connection.query(updateQuery, updateValues);
      }

      await connection.commit();

      // Log activity
      await logActivity(
        userId,
        "page_update",
        `Updated page: ${pageId}`,
        pageId,
        "page",
      );

      res.json({
        success: true,
        message: "Page updated successfully",
        data: {
          page_id: pageId,
          page_picture_url: pagePicturePath
            ? await storageManager.getPublicUrl(pagePicturePath)
            : null,
          page_cover_url: pageCoverPath
            ? await storageManager.getPublicUrl(pageCoverPath)
            : null,
        },
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 4. DELETE PAGE
  static async deletePage(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const pageId = req.params.pageId;
      const userId = PagesController.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Check if user is creator
      const isCreator = await PagesController.isUserCreator(pageId, userId);
      if (!isCreator) {
        throw new UnauthorizedPageError(
          "Only the page creator can delete the page",
        );
      }

      // Get page details for cleanup
      const [page] = await connection.query(
        "SELECT page_picture, page_picture_id, page_cover, page_cover_id FROM pages WHERE page_id = ?",
        [pageId],
      );

      if (page.length === 0) {
        throw new PageNotFoundError();
      }

      // Delete associated files
      if (page[0].page_picture && page[0].page_picture_id) {
        await PagesController.deleteOldFile(
          page[0].page_picture,
          page[0].page_picture_id,
        );
      }

      if (page[0].page_cover && page[0].page_cover_id) {
        await PagesController.deleteOldFile(
          page[0].page_cover,
          page[0].page_cover_id,
        );
      }

      // Delete page data (cascade will handle related records)
      await connection.query("DELETE FROM pages WHERE page_id = ?", [pageId]);

      await connection.commit();

      // Log activity
      await logActivity(
        userId,
        "page_delete",
        `Deleted page: ${pageId}`,
        pageId,
        "page",
      );

      res.json({
        success: true,
        message: "Page deleted successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 5. LIKE/UNLIKE PAGE
  static async toggleLikePage(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const pageId = req.params.pageId;
      const userId = PagesController.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Check if page exists
      const [page] = await connection.query(
        "SELECT page_id FROM pages WHERE page_id = ?",
        [pageId],
      );

      if (page.length === 0) {
        throw new PageNotFoundError();
      }

      // Check if already liked
      const [existingLike] = await connection.query(
        "SELECT id FROM pages_likes WHERE page_id = ? AND user_id = ?",
        [pageId, userId],
      );

      let action = "";

      if (existingLike.length > 0) {
        // Unlike
        await connection.query(
          "DELETE FROM pages_likes WHERE page_id = ? AND user_id = ?",
          [pageId, userId],
        );
        await connection.query(
          "UPDATE pages SET page_likes = page_likes - 1 WHERE page_id = ?",
          [pageId],
        );
        action = "unliked";
      } else {
        // Like
        await connection.query(
          "INSERT INTO pages_likes (page_id, user_id) VALUES (?, ?)",
          [pageId, userId],
        );
        await connection.query(
          "UPDATE pages SET page_likes = page_likes + 1 WHERE page_id = ?",
          [pageId],
        );
        action = "liked";

        // Send notification to page admins
        const [admins] = await connection.query(
          "SELECT user_id FROM pages_admins WHERE page_id = ?",
          [pageId],
        );

        for (const admin of admins) {
          if (admin.user_id !== userId) {
            await connection.query(
              `INSERT INTO notifications 
               (to_user_id, from_user_id, from_user_type, action, node_type, node_url, time, seen) 
               VALUES (?, ?, 'user', 'liked_page', 'page', ?, NOW(), '0')`,
              [admin.user_id, userId, `/pages/${pageId}`],
            );
          }
        }
      }

      await connection.commit();

      // Get updated likes count
      const [updatedPage] = await connection.query(
        "SELECT page_likes FROM pages WHERE page_id = ?",
        [pageId],
      );

      res.json({
        success: true,
        message: `Page ${action} successfully`,
        data: {
          liked: action === "liked",
          total_likes: updatedPage[0]?.page_likes || 0,
        },
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 6. GET PAGE ADMINS
  static async getPageAdmins(req, res, next) {
    try {
      const pageId = req.params.pageId;
      const userId = PagesController.getCurrentUserId(req);

      // Check if page exists
      const [page] = await pool.query(
        "SELECT page_id FROM pages WHERE page_id = ?",
        [pageId],
      );

      if (page.length === 0) {
        throw new PageNotFoundError();
      }

      const [admins] = await pool.query(
        `SELECT u.user_id, u.user_name, u.user_firstname, u.user_lastname, 
                u.user_picture, u.user_verified, u.user_registered,
                (SELECT COUNT(*) FROM posts WHERE user_id = u.user_id AND user_type = 'user') as total_posts,
                (SELECT COUNT(*) FROM followings WHERE user_id = u.user_id) as total_followers
         FROM pages_admins pa
         JOIN users u ON pa.user_id = u.user_id
         WHERE pa.page_id = ?
         ORDER BY u.user_firstname, u.user_lastname`,
        [pageId],
      );

      res.json({
        success: true,
        data: admins,
      });
    } catch (error) {
      next(error);
    }
  }

  // 7. ADD PAGE ADMIN
  static async addPageAdmin(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const pageId = req.params.pageId;
      const { user_id } = req.body;
      const currentUserId = PagesController.getCurrentUserId(req);

      if (!currentUserId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Check if current user is page creator
      const isCreator = await PagesController.isUserCreator(
        pageId,
        currentUserId,
      );
      if (!isCreator) {
        throw new UnauthorizedPageError("Only the page creator can add admins");
      }

      // Check if page exists
      const [page] = await connection.query(
        "SELECT page_id FROM pages WHERE page_id = ?",
        [pageId],
      );

      if (page.length === 0) {
        throw new PageNotFoundError();
      }

      // Check if target user exists
      const [targetUser] = await connection.query(
        "SELECT user_id FROM users WHERE user_id = ?",
        [user_id],
      );

      if (targetUser.length === 0) {
        throw new ValidationPageError("User not found");
      }

      // Check if user is already an admin
      const [existingAdmin] = await connection.query(
        "SELECT id FROM pages_admins WHERE page_id = ? AND user_id = ?",
        [pageId, user_id],
      );

      if (existingAdmin.length > 0) {
        throw new ValidationPageError("User is already an admin of this page");
      }

      // Add as admin
      await connection.query(
        "INSERT INTO pages_admins (page_id, user_id) VALUES (?, ?)",
        [pageId, user_id],
      );

      // Send notification to new admin
      await connection.query(
        `INSERT INTO notifications 
         (to_user_id, from_user_id, from_user_type, action, node_type, node_url, time, seen) 
         VALUES (?, ?, 'user', 'added_as_page_admin', 'page', ?, NOW(), '0')`,
        [user_id, currentUserId, `/pages/${pageId}`],
      );

      await connection.commit();

      res.json({
        success: true,
        message: "User added as page admin successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 8. REMOVE PAGE ADMIN
  static async removePageAdmin(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const pageId = req.params.pageId;
      const adminId = req.params.adminId;
      const currentUserId = PagesController.getCurrentUserId(req);

      if (!currentUserId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Check if current user is page creator
      const isCreator = await PagesController.isUserCreator(
        pageId,
        currentUserId,
      );
      if (!isCreator) {
        throw new UnauthorizedPageError(
          "Only the page creator can remove admins",
        );
      }

      // Check if trying to remove self
      if (parseInt(adminId) === parseInt(currentUserId)) {
        throw new ValidationPageError("Cannot remove yourself as admin");
      }

      // Remove admin
      await connection.query(
        "DELETE FROM pages_admins WHERE page_id = ? AND user_id = ?",
        [pageId, adminId],
      );

      // Send notification to removed admin
      await connection.query(
        `INSERT INTO notifications 
         (to_user_id, from_user_id, from_user_type, action, node_type, node_url, time, seen) 
         VALUES (?, ?, 'user', 'removed_as_page_admin', 'page', ?, NOW(), '0')`,
        [adminId, currentUserId, `/pages/${pageId}`],
      );

      await connection.commit();

      res.json({
        success: true,
        message: "Admin removed successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 9. GET PAGE LIKERS
  static async getPageLikers(req, res, next) {
    try {
      const pageId = req.params.pageId;
      const { page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      // Check if page exists
      const [pageExists] = await pool.query(
        "SELECT page_id FROM pages WHERE page_id = ?",
        [pageId],
      );

      if (pageExists.length === 0) {
        throw new PageNotFoundError();
      }

      // Get likers with pagination
      const [likers] = await pool.query(
        `SELECT u.user_id, u.user_name, u.user_firstname, u.user_lastname, 
                u.user_picture, u.user_verified, u.user_registered,
                (SELECT COUNT(*) FROM posts WHERE user_id = u.user_id AND user_type = 'user') as total_posts,
                (SELECT COUNT(*) FROM followings WHERE user_id = u.user_id) as total_followers
         FROM pages_likes pl
         JOIN users u ON pl.user_id = u.user_id
         WHERE pl.page_id = ?
         ORDER BY pl.id DESC
         LIMIT ? OFFSET ?`,
        [pageId, parseInt(limit), parseInt(offset)],
      );

      // Get total count
      const [totalResult] = await pool.query(
        "SELECT COUNT(*) as total FROM pages_likes WHERE page_id = ?",
        [pageId],
      );

      res.json({
        success: true,
        data: {
          likers: likers,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: totalResult[0]?.total || 0,
            pages: Math.ceil((totalResult[0]?.total || 0) / limit),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 10. INVITE USER TO LIKE PAGE
  static async inviteToPage(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const pageId = req.params.pageId;
      const { user_id } = req.body;
      const currentUserId = PagesController.getCurrentUserId(req);

      if (!currentUserId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Check if current user is page admin
      const isAdmin = await PagesController.isUserAdmin(pageId, currentUserId);
      if (!isAdmin) {
        throw new UnauthorizedPageError("Only page admins can invite users");
      }

      // Check if page exists
      const [page] = await connection.query(
        "SELECT page_id, page_title FROM pages WHERE page_id = ?",
        [pageId],
      );

      if (page.length === 0) {
        throw new PageNotFoundError();
      }

      // Check if target user exists
      const [targetUser] = await connection.query(
        "SELECT user_id, user_name FROM users WHERE user_id = ?",
        [user_id],
      );

      if (targetUser.length === 0) {
        throw new ValidationPageError("User not found");
      }

      // Check if user already likes the page
      const [alreadyLiked] = await connection.query(
        "SELECT id FROM pages_likes WHERE page_id = ? AND user_id = ?",
        [pageId, user_id],
      );

      if (alreadyLiked.length > 0) {
        throw new ValidationPageError("User already likes this page");
      }

      // Check if user already invited
      const [alreadyInvited] = await connection.query(
        "SELECT id FROM pages_invites WHERE page_id = ? AND user_id = ?",
        [pageId, user_id],
      );

      if (alreadyInvited.length > 0) {
        throw new ValidationPageError("User already invited to this page");
      }

      // Create invite
      await connection.query(
        "INSERT INTO pages_invites (page_id, user_id, from_user_id) VALUES (?, ?, ?)",
        [pageId, user_id, currentUserId],
      );

      // Send notification
      await connection.query(
        `INSERT INTO notifications 
         (to_user_id, from_user_id, from_user_type, action, node_type, node_url, message, time, seen) 
         VALUES (?, ?, 'user', 'invited_to_page', 'page', ?, ?, NOW(), '0')`,
        [
          user_id,
          currentUserId,
          `/pages/${pageId}`,
          `You've been invited to like "${page[0].page_title}"`,
        ],
      );

      await connection.commit();

      res.json({
        success: true,
        message: "User invited to page successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 11. GET PAGE INVITES
  static async getPageInvites(req, res, next) {
    try {
      const pageId = req.params.pageId;
      const currentUserId = PagesController.getCurrentUserId(req);

      if (!currentUserId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Check if current user is page admin
      const isAdmin = await PagesController.isUserAdmin(pageId, currentUserId);
      if (!isAdmin) {
        throw new UnauthorizedPageError("Only page admins can view invites");
      }

      // Get invites
      const [invites] = await pool.query(
        `SELECT pi.*, 
                u.user_id, u.user_name, u.user_firstname, u.user_lastname, u.user_picture,
                inviter.user_id as inviter_id, inviter.user_name as inviter_username,
                inviter.user_firstname as inviter_firstname, inviter.user_lastname as inviter_lastname
         FROM pages_invites pi
         JOIN users u ON pi.user_id = u.user_id
         JOIN users inviter ON pi.from_user_id = inviter.user_id
         WHERE pi.page_id = ?
         ORDER BY pi.id DESC`,
        [pageId],
      );

      res.json({
        success: true,
        data: invites,
      });
    } catch (error) {
      next(error);
    }
  }

  // 12. CANCEL PAGE INVITE
  static async cancelPageInvite(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { pageId, inviteId } = req.params;
      const currentUserId = PagesController.getCurrentUserId(req);

      if (!currentUserId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Check if current user is page admin
      const isAdmin = await PagesController.isUserAdmin(pageId, currentUserId);
      if (!isAdmin) {
        throw new UnauthorizedPageError("Only page admins can cancel invites");
      }

      // Delete invite
      const [result] = await connection.query(
        "DELETE FROM pages_invites WHERE id = ? AND page_id = ?",
        [inviteId, pageId],
      );

      if (result.affectedRows === 0) {
        throw new ValidationPageError("Invite not found");
      }

      await connection.commit();

      res.json({
        success: true,
        message: "Invite cancelled successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 13. GET USER'S PAGES
  static async getUserPages(req, res, next) {
    try {
      const targetUserId =
        req.params.userId || PagesController.getCurrentUserId(req);
      const { page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      if (!targetUserId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Get pages where user is admin
      const [pages] = await pool.query(
        `SELECT p.*, 
                pc.category_name,
                (SELECT COUNT(*) FROM pages_likes WHERE page_id = p.page_id) as total_likes,
                (SELECT COUNT(*) FROM posts WHERE user_id = p.page_id AND user_type = 'page') as total_posts
         FROM pages p
         LEFT JOIN pages_categories pc ON p.page_category = pc.category_id
         WHERE p.page_admin = ? OR p.page_id IN (SELECT page_id FROM pages_admins WHERE user_id = ?)
         ORDER BY p.page_date DESC
         LIMIT ? OFFSET ?`,
        [targetUserId, targetUserId, parseInt(limit), parseInt(offset)],
      );

      // Get total count
      const [totalResult] = await pool.query(
        `SELECT COUNT(*) as total 
         FROM pages 
         WHERE page_admin = ? OR page_id IN (SELECT page_id FROM pages_admins WHERE user_id = ?)`,
        [targetUserId, targetUserId],
      );

      // Get liked pages
      const [likedPages] = await pool.query(
        `SELECT p.*, pc.category_name
         FROM pages_likes pl
         JOIN pages p ON pl.page_id = p.page_id
         LEFT JOIN pages_categories pc ON p.page_category = pc.category_id
         WHERE pl.user_id = ?
         ORDER BY pl.id DESC
         LIMIT 10`,
        [targetUserId],
      );

      res.json({
        success: true,
        data: {
          managed_pages: pages,
          liked_pages: likedPages,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: totalResult[0]?.total || 0,
            pages: Math.ceil((totalResult[0]?.total || 0) / limit),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 14. GET PAGE CATEGORIES
  static async getPageCategories(req, res, next) {
    try {
      const { parent_id = 0 } = req.query;

      const [categories] = await pool.query(
        `SELECT category_id, category_parent_id, category_name, category_description, category_order
         FROM pages_categories
         WHERE category_parent_id = ?
         ORDER BY category_order ASC, category_name ASC`,
        [parent_id],
      );

      // Get subcategories count for each category
      for (let category of categories) {
        const [subCount] = await pool.query(
          "SELECT COUNT(*) as count FROM pages_categories WHERE category_parent_id = ?",
          [category.category_id],
        );
        category.has_subcategories = subCount[0]?.count > 0;
      }

      res.json({
        success: true,
        data: categories,
      });
    } catch (error) {
      next(error);
    }
  }

  // 15. SEARCH PAGES
  static async searchPages(req, res, next) {
    try {
      const {
        query,
        category_id,
        country_id,
        verified,
        sort = "popular",
        page = 1,
        limit = 20,
      } = req.query;
      const offset = (page - 1) * limit;
      const currentUserId = PagesController.getCurrentUserId(req);

      let whereClauses = ["1=1"];
      let queryParams = [];

      if (query) {
        whereClauses.push("(p.page_title LIKE ? OR p.page_description LIKE ?)");
        queryParams.push(`%${query}%`, `%${query}%`);
      }

      if (category_id) {
        whereClauses.push("p.page_category = ?");
        queryParams.push(category_id);
      }

      if (country_id) {
        whereClauses.push("p.page_country = ?");
        queryParams.push(country_id);
      }

      if (verified !== undefined) {
        whereClauses.push("p.page_verified = ?");
        queryParams.push(verified);
      }

      let orderBy = "p.page_likes DESC";
      if (sort === "recent") {
        orderBy = "p.page_date DESC";
      } else if (sort === "name") {
        orderBy = "p.page_title ASC";
      }

      // Get pages
      const [pages] = await pool.query(
        `SELECT p.*, pc.category_name, sc.country_name,
                (SELECT COUNT(*) FROM pages_likes WHERE page_id = p.page_id) as total_likes,
                (SELECT COUNT(*) FROM posts WHERE user_id = p.page_id AND user_type = 'page') as total_posts
         FROM pages p
         LEFT JOIN pages_categories pc ON p.page_category = pc.category_id
         LEFT JOIN system_countries sc ON p.page_country = sc.country_id
         WHERE ${whereClauses.join(" AND ")}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
        [...queryParams, parseInt(limit), parseInt(offset)],
      );

      // Check if current user likes each page
      if (currentUserId) {
        for (let page of pages) {
          const [like] = await pool.query(
            "SELECT 1 FROM pages_likes WHERE page_id = ? AND user_id = ?",
            [page.page_id, currentUserId],
          );
          page.is_liked = like.length > 0;

          const [admin] = await pool.query(
            "SELECT 1 FROM pages_admins WHERE page_id = ? AND user_id = ?",
            [page.page_id, currentUserId],
          );
          page.is_admin = admin.length > 0;
        }
      }

      // Get total count
      const [totalResult] = await pool.query(
        `SELECT COUNT(*) as total 
         FROM pages p
         WHERE ${whereClauses.join(" AND ")}`,
        queryParams,
      );

      res.json({
        success: true,
        data: {
          pages: pages,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: totalResult[0]?.total || 0,
            pages: Math.ceil((totalResult[0]?.total || 0) / limit),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 16. GET PAGE STATISTICS
  static async getPageStats(req, res, next) {
    try {
      const pageId = req.params.pageId;
      const currentUserId = PagesController.getCurrentUserId(req);

      if (!currentUserId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Check if user is page admin
      const isAdmin = await PagesController.isUserAdmin(pageId, currentUserId);
      if (!isAdmin) {
        throw new UnauthorizedPageError("Only page admins can view statistics");
      }

      const today = new Date();
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Get likes statistics
      const [likesStats] = await pool.query(
        `SELECT 
           COUNT(*) as total_likes,
           SUM(CASE WHEN DATE(pl.created_at) = CURDATE() THEN 1 ELSE 0 END) as likes_today,
           SUM(CASE WHEN pl.created_at >= ? THEN 1 ELSE 0 END) as likes_this_week,
           SUM(CASE WHEN pl.created_at >= ? THEN 1 ELSE 0 END) as likes_this_month
         FROM pages_likes pl
         WHERE pl.page_id = ?`,
        [weekAgo, monthAgo, pageId],
      );

      // Get posts statistics
      const [postsStats] = await pool.query(
        `SELECT 
           COUNT(*) as total_posts,
           SUM(CASE WHEN DATE(p.time) = CURDATE() THEN 1 ELSE 0 END) as posts_today,
           SUM(CASE WHEN p.time >= ? THEN 1 ELSE 0 END) as posts_this_week,
           SUM(CASE WHEN p.time >= ? THEN 1 ELSE 0 END) as posts_this_month
         FROM posts p
         WHERE p.user_id = ? AND p.user_type = 'page'`,
        [weekAgo, monthAgo, pageId],
      );

      // Get engagement rate (likes per post)
      const engagementRate =
        postsStats[0]?.total_posts > 0
          ? (likesStats[0]?.total_likes / postsStats[0]?.total_posts).toFixed(2)
          : 0;

      // Get top posts
      const [topPosts] = await pool.query(
        `SELECT post_id, text, time, 
                (reaction_like_count + reaction_love_count + reaction_haha_count + 
                 reaction_yay_count + reaction_wow_count + reaction_sad_count + reaction_angry_count) as total_reactions,
                comments, shares, views
         FROM posts 
         WHERE user_id = ? AND user_type = 'page'
         ORDER BY (reaction_like_count + reaction_love_count + reaction_haha_count + 
                   reaction_yay_count + reaction_wow_count + reaction_sad_count + reaction_angry_count) DESC
         LIMIT 5`,
        [pageId],
      );

      res.json({
        success: true,
        data: {
          likes: likesStats[0] || {},
          posts: postsStats[0] || {},
          engagement_rate: engagementRate,
          top_posts: topPosts,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 17. BOOST PAGE
  // Update the boostPage function in pagesController.js

  static async boostPage(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const pageId = req.params.pageId;
      const currentUserId = PagesController.getCurrentUserId(req);
      const { duration_days = 7 } = req.body;

      if (!currentUserId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Check if user is page admin
      const isAdmin = await PagesController.isUserAdmin(pageId, currentUserId);
      if (!isAdmin) {
        throw new UnauthorizedPageError("Only page admins can boost the page");
      }

      // Check if page already boosted
      const [existingBoost] = await connection.query(
        "SELECT 1 FROM pages WHERE page_id = ? AND page_boosted = '1'",
        [pageId],
      );

      if (existingBoost.length > 0) {
        throw new ValidationPageError("Page is already boosted");
      }

      // Check user's boost balance
      const [user] = await connection.query(
        "SELECT user_boosted_pages, user_name FROM users WHERE user_id = ?",
        [currentUserId],
      );

      if (user.length === 0) {
        throw new ValidationPageError("User not found");
      }

      // Check if page exists
      const [page] = await connection.query(
        "SELECT page_title, page_admin FROM pages WHERE page_id = ?",
        [pageId],
      );

      if (page.length === 0) {
        throw new PageNotFoundError();
      }

      // Update page as boosted
      await connection.query(
        "UPDATE pages SET page_boosted = '1', page_boosted_by = ? WHERE page_id = ?",
        [currentUserId, pageId],
      );

      // Deduct from user's boost credits
      await connection.query(
        "UPDATE users SET user_boosted_pages = user_boosted_pages - 1 WHERE user_id = ?",
        [currentUserId],
      );

      // Schedule unboost (this would typically be handled by a cron job)
      const boostEndDate = new Date();
      boostEndDate.setDate(boostEndDate.getDate() + parseInt(duration_days));

      await connection.query(
        `INSERT INTO boosted_pages_log 
       (page_id, user_id, boost_start, boost_end, duration_days) 
       VALUES (?, ?, NOW(), ?, ?)`,
        [pageId, currentUserId, boostEndDate, duration_days],
      );

      // Send notification to page admins about the boost
      const [admins] = await connection.query(
        "SELECT user_id FROM pages_admins WHERE page_id = ? AND user_id != ?",
        [pageId, currentUserId],
      );

      for (const admin of admins) {
        await connection.query(
          `INSERT INTO notifications 
         (to_user_id, from_user_id, from_user_type, action, node_type, node_url, message, time, seen) 
         VALUES (?, ?, 'user', 'page_boosted', 'page', ?, ?, NOW(), '0')`,
          [
            admin.user_id,
            currentUserId,
            `/pages/${pageId}`,
            `${user[0].user_name} boosted the page "${page[0].page_title}" for ${duration_days} days`,
          ],
        );
      }

      await connection.commit();

      // Log activity
      await logActivity(
        currentUserId,
        "page_boost",
        `Boosted page: ${pageId}`,
        pageId,
        "page",
      );

      res.json({
        success: true,
        message: "Page boosted successfully!",
        data: {
          boost_end: boostEndDate,
          remaining_credits: user[0].user_boosted_pages - 1,
          duration_days: duration_days,
        },
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 18. UNBOOST PAGE
  static async unboostPage(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const pageId = req.params.pageId;
      const currentUserId = PagesController.getCurrentUserId(req);

      if (!currentUserId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Check if user is page admin or the one who boosted it
      const [page] = await connection.query(
        "SELECT page_boosted_by FROM pages WHERE page_id = ? AND page_boosted = '1'",
        [pageId],
      );

      if (page.length === 0) {
        throw new ValidationPageError("Page is not boosted");
      }

      const isAdmin = await PagesController.isUserAdmin(pageId, currentUserId);
      const isBooster = page[0].page_boosted_by === currentUserId;

      if (!isAdmin && !isBooster) {
        throw new UnauthorizedPageError("Not authorized to unboost this page");
      }

      // Unboost page
      await connection.query(
        "UPDATE pages SET page_boosted = '0', page_boosted_by = NULL WHERE page_id = ?",
        [pageId],
      );

      // Update boost log
      await connection.query(
        "UPDATE boosted_pages_log SET boost_ended_early = '1', boost_actual_end = NOW() WHERE page_id = ? AND boost_end > NOW()",
        [pageId],
      );

      await connection.commit();

      res.json({
        success: true,
        message: "Page unboosted successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 19. GET PAGE POSTS
  // 20. CREATE PAGE POST
  static async createPagePost(req, res, next) {
    console.log("Creating page post - Body:", req.body);
    console.log("Files:", req.files);

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const pageId = req.params.pageId;
      const currentUserId = PagesController.getCurrentUserId(req);

      if (!currentUserId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Check if user is page admin
      const isAdmin = await PagesController.isUserAdmin(pageId, currentUserId);
      if (!isAdmin) {
        throw new UnauthorizedPageError("Only page admins can create posts");
      }

      const {
        text,
        privacy = "public",
        location,
        feeling_action,
        feeling_value,
        colored_pattern,
        link,
        post_type = "text",

        // Article fields
        article_title,
        article_content,
        article_category_id,
        article_tags,

        // Poll fields
        poll_question,
        poll_options,
        poll_end_date,

        // Job fields
        job_title,
        job_category_id,
        job_location,
        job_salary_minimum,
        job_salary_maximum,
        job_pay_salary_per,
        job_type,
        job_available = "1",

        // Product fields
        product_name,
        product_price,
        product_quantity = 1,
        product_category_id,
        product_status = "new",
        product_location,
        product_is_digital = "0",
        product_download_url,

        // Funding fields
        funding_title,
        funding_amount,

        // Settings
        is_anonymous = "0",
        for_adult = "0",
        disable_comments = "0",
        is_paid = "0",
        post_price = 0,
        paid_text,
        for_subscriptions = "0",
        tips_enabled = "0",
      } = req.body;

      // Validate privacy setting
      const isValidPrivacy = await PostService.validatePostPrivacy(
        privacy,
        "page",
      );
      if (!isValidPrivacy) {
        throw new Error("Invalid privacy setting for page");
      }

      // Prepare files object for PostService
      const files = {
        photos: req.files?.photos || [],
        videos: req.files?.videos || [],
        files: req.files?.files || [],
      };

      // Prepare post type specific data
      let postTypeSpecificData = {};

      switch (post_type) {
        case "article":
          files.articleData = {
            title: article_title,
            text: article_content,
            category_id: article_category_id,
            tags: article_tags
              ? article_tags.split(",").map((tag) => tag.trim())
              : [],
          };
          files.cover = req.files?.cover || [];
          break;

        case "poll":
          files.pollData = {
            options: poll_options ? JSON.parse(poll_options) : [],
            end_date: poll_end_date || null,
          };
          break;

        case "job":
          files.jobData = {
            title: job_title,
            category_id: job_category_id,
            location: job_location,
            salary_minimum: parseFloat(job_salary_minimum) || 0,
            salary_maximum: parseFloat(job_salary_maximum) || 0,
            pay_salary_per: job_pay_salary_per || "month",
            type: job_type || "full_time",
            available: job_available === "1",
          };
          files.coverImage = req.files?.cover_image || [];
          break;

        case "product":
          files.productData = {
            name: product_name,
            price: parseFloat(product_price) || 0,
            quantity: parseInt(product_quantity) || 1,
            category_id: product_category_id,
            status: product_status,
            location: product_location,
            available: true,
            is_digital: product_is_digital === "1",
            product_download_url: product_download_url,
          };
          files.productImages = req.files?.product_images || [];
          break;

        case "funding":
          files.fundingData = {
            title: funding_title,
            amount: parseFloat(funding_amount) || 0,
          };
          files.coverImage = req.files?.cover_image || [];
          break;

        case "audio":
          files.audio = req.files?.audio || [];
          break;

        case "live":
          files.liveData = {
            thumbnail: req.files?.thumbnail ? req.files.thumbnail[0] : null,
          };
          break;

        case "media":
          files.media = {
            source_url: link || req.body.media_url,
            source_provider: req.body.media_provider || "unknown",
            source_type: req.body.media_type || "video",
            source_title: req.body.media_title,
          };
          break;
      }

      // Create post using PostService
      const result = await PostService.createPost({
        userId: pageId,
        userType: "page",
        text: text || (post_type === "poll" ? poll_question : null),
        privacy,
        location,
        feeling_action,
        feeling_value,
        colored_pattern,
        postType: post_type,
        files,
        link: post_type === "link" ? link : null,
        inGroup: false,
        inEvent: false,
        inWall: false,
        isAnonymous: is_anonymous === "1",
        forAdult: for_adult === "1",
        disableComments: disable_comments === "1",
        isPaid: is_paid === "1",
        postPrice: parseFloat(post_price) || 0,
        forSubscriptions: for_subscriptions === "1",
        tipsEnabled: tips_enabled === "1",
      });

      // Update page's pinned post if this is a pinned post
      if (req.body.is_pinned === "1") {
        await connection.query(
          "UPDATE pages SET page_pinned_post = ? WHERE page_id = ?",
          [result.postId, pageId],
        );
      }

      // Handle hashtags
      if (text) {
        await PagesController.extractAndStoreHashtags(
          connection,
          result.postId,
          text,
        );
      }

      // Handle mentions
      if (text) {
        await PagesController.handleMentions(
          connection,
          result.postId,
          text,
          pageId,
          "page",
        );
      }

      await connection.commit();

      // Log activity
      await logActivity(
        currentUserId,
        "page_post_create",
        `Created ${post_type} post on page: ${pageId}`,
        result.postId,
        "post",
      );

      // Get full post data for response
      const fullPost = await PostService.getPostById(result.postId);

      res.status(201).json({
        success: true,
        message: `${post_type.charAt(0).toUpperCase() + post_type.slice(1)} post created successfully`,
        data: {
          post: fullPost,
          post_id: result.postId,
          page_id: pageId,
          post_type: post_type,
          ...result,
        },
      });
    } catch (error) {
      await connection.rollback();
      console.error("Error creating page post:", error);

      // Handle specific errors
      if (error instanceof UnauthorizedPageError) {
        return res.status(403).json({
          success: false,
          message: error.message,
        });
      }

      if (error.code === "ER_NO_REFERENCED_ROW_2") {
        return res.status(400).json({
          success: false,
          message: "Invalid page ID or reference",
        });
      }

      next(error);
    } finally {
      connection.release();
    }
  }

  // Helper method to extract and store hashtags
  static async extractAndStoreHashtags(connection, postId, text) {
    const hashtagRegex = /#(\w+)/g;
    const matches = [...text.matchAll(hashtagRegex)];

    for (const match of matches) {
      const hashtagText = match[1].toLowerCase();

      // Check if hashtag exists
      let [hashtags] = await connection.query(
        "SELECT hashtag_id FROM hashtags WHERE hashtag = ?",
        [hashtagText],
      );

      let hashtagId;
      if (hashtags.length === 0) {
        // Create new hashtag
        const [result] = await connection.query(
          "INSERT INTO hashtags (hashtag) VALUES (?)",
          [hashtagText],
        );
        hashtagId = result.insertId;
      } else {
        hashtagId = hashtags[0].hashtag_id;
      }

      // Link hashtag to post
      await connection.query(
        "INSERT INTO hashtags_posts (post_id, hashtag_id) VALUES (?, ?)",
        [postId, hashtagId],
      );
    }
  }

  // Helper method to handle mentions
  static async handleMentions(connection, postId, text, fromId, fromType) {
    const mentionRegex = /@(\w+)/g;
    const matches = [...text.matchAll(mentionRegex)];

    for (const match of matches) {
      const username = match[1];

      // Find user by username
      const [users] = await connection.query(
        "SELECT user_id FROM users WHERE user_name = ?",
        [username],
      );

      if (users.length > 0) {
        const mentionedUserId = users[0].user_id;

        // Create notification for mention
        await connection.query(
          `INSERT INTO notifications 
           (to_user_id, from_user_id, from_user_type, action, node_type, node_url, time) 
           VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [
            mentionedUserId,
            fromId,
            fromType,
            "mentioned you in a post",
            "post",
            `/post/${postId}`,
          ],
        );
      }
    }
  }

  // Get page posts
  static async getPagePosts(req, res, next) {
    try {
      const pageId = req.params.pageId;
      const { limit = 20, offset = 0 } = req.query;
      const currentUserId = req.user?.id;

      const [posts] = await pool.query(
        `SELECT p.*, 
        pg.page_name, pg.page_title, pg.page_picture,
        COUNT(DISTINCT pr.id) as reactions_count,
        COUNT(DISTINCT pc.comment_id) as comments_count,
        COUNT(DISTINCT ps.post_id) as shares_count
       FROM posts p
       JOIN pages pg ON p.user_id = pg.page_id AND p.user_type = 'page'
       LEFT JOIN posts_reactions pr ON p.post_id = pr.post_id
       LEFT JOIN posts_comments pc ON p.post_id = pc.node_id AND pc.node_type = 'post'
       LEFT JOIN posts ps ON ps.origin_id = p.post_id
       WHERE p.user_id = ? AND p.user_type = 'page'
         AND p.in_group = '0' AND p.in_event = '0'
       GROUP BY p.post_id
       ORDER BY p.time DESC
       LIMIT ? OFFSET ?`,
        [pageId, parseInt(limit), parseInt(offset)],
      );

      // Enrich each post with its specific data
      const enrichedPosts = [];
      for (const post of posts) {
        const enrichedPost = { ...post };

        // Get post type specific data using your existing enrich methods
        switch (post.post_type) {
          case "photo":
          case "page_picture":
          case "page_cover":
            await PostService.enrichPhotoPost(enrichedPost, post.post_id);
            break;

          case "video":
            await PostService.enrichVideoPost(enrichedPost, post.post_id);
            break;

          case "file":
            await PostService.enrichFilePost(enrichedPost, post.post_id);
            break;

          case "link":
            await PostService.enrichLinkPost(enrichedPost, post.post_id);
            break;

          case "article":
            await PostService.enrichArticlePost(enrichedPost, post.post_id);
            break;

          case "poll":
            await PostService.enrichPollPost(
              enrichedPost,
              post.post_id,
              currentUserId,
            );
            break;

          case "job":
            await PostService.enrichJobPost(enrichedPost, post.post_id);
            break;

          case "product":
            await PostService.enrichProductPost(enrichedPost, post.post_id);
            break;

          case "funding":
            await PostService.enrichFundingPost(enrichedPost, post.post_id);
            break;

          case "live":
            await PostService.enrichLivePost(enrichedPost, post.post_id);
            break;

          case "audio":
            await PostService.enrichAudioPost(enrichedPost, post.post_id);
            break;

          case "media":
            await PostService.enrichMediaPost(enrichedPost, post.post_id);
            break;

          case "shared":
            // For shared posts, get the original post data
            await PostService.enrichSharedPost(enrichedPost, post.post_id);
            break;
        }

        // Get reaction counts by type
        await PostService.enrichReactionCounts(enrichedPost, post.post_id);

        // Get comments preview
        await PostService.enrichComments(enrichedPost, post.post_id, currentUserId);

        // Check if current user has reacted
        if (currentUserId) {
          await PostService.enrichUserReaction(
            enrichedPost,
            post.post_id,
            currentUserId,
          );
          await PostService.enrichUserSaved(enrichedPost, post.post_id, currentUserId);
        }

        enrichedPosts.push(enrichedPost);
      }

      res.json({
        success: true,
        data: {
          posts: enrichedPosts,
          total: enrichedPosts.length,
          limit: parseInt(limit),
          offset: parseInt(offset),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // Add this new method for shared posts


  // Update page post
  static async updatePagePost(req, res, next) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const { pageId, postId } = req.params;
      const currentUserId = this.getCurrentUserId(req);

      if (!currentUserId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Check if user is page admin
      const isAdmin = await this.isUserAdmin(pageId, currentUserId);
      if (!isAdmin) {
        throw new UnauthorizedPageError("Only page admins can update posts");
      }

      const { text, privacy, location } = req.body;

      // Update post
      await connection.query(
        `UPDATE posts 
         SET text = ?, privacy = ?, location = ?, time = NOW() 
         WHERE post_id = ? AND user_id = ? AND user_type = 'page'`,
        [text, privacy, location, postId, pageId],
      );

      // Update hashtags if text changed
      if (text) {
        // Remove old hashtags
        await connection.query(
          `DELETE hp FROM hashtags_posts hp
           JOIN hashtags h ON hp.hashtag_id = h.hashtag_id
           WHERE hp.post_id = ?`,
          [postId],
        );

        // Add new hashtags
        await this.extractAndStoreHashtags(connection, postId, text);
      }

      await connection.commit();

      // Get updated post
      const updatedPost = await PostService.getPostById(postId);

      res.json({
        success: true,
        message: "Post updated successfully",
        data: {
          post: updatedPost,
        },
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // Delete page post
  static async deletePagePost(req, res, next) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const { pageId, postId } = req.params;
      const currentUserId = this.getCurrentUserId(req);

      if (!currentUserId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Check if user is page admin
      const isAdmin = await this.isUserAdmin(pageId, currentUserId);
      if (!isAdmin) {
        throw new UnauthorizedPageError("Only page admins can delete posts");
      }

      // Delete post (cascade will handle related records)
      await connection.query(
        "DELETE FROM posts WHERE post_id = ? AND user_id = ? AND user_type = 'page'",
        [postId, pageId],
      );

      await connection.commit();

      // Log activity
      await logActivity(
        currentUserId,
        "page_post_delete",
        `Deleted post ${postId} from page: ${pageId}`,
        postId,
        "post",
      );

      res.json({
        success: true,
        message: "Post deleted successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // In your routes file (e.g., systemRoutes.js)
  static async getCountries(req, res, next) {
    try {
      const [countries] = await pool.query(
        `SELECT country_id, country_code, country_name, phone_code 
       FROM system_countries 
       WHERE enabled = '1' 
       ORDER BY country_order ASC, country_name ASC`,
      );

      res.json({
        success: true,
        data: countries,
      });
    } catch (error) {
      next(error);
    }
  }

  // Add this to your pagesController.js

  // REPORT PAGE
  static async reportPage(req, res, next) {
    const connection = await pool.getConnection();
    try {
      const pageId = req.params.pageId;
      const userId = PagesController.getCurrentUserId(req);
      const { reason, category_id } = req.body;

      if (!userId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      if (!reason?.trim()) {
        throw new ValidationPageError("Please provide a reason for reporting");
      }

      // Check if page exists
      const [page] = await connection.query(
        "SELECT page_id, page_title, page_admin FROM pages WHERE page_id = ?",
        [pageId],
      );

      if (page.length === 0) {
        throw new PageNotFoundError();
      }

      // Check if user already reported this page
      const [existingReport] = await connection.query(
        `SELECT 1 FROM reports 
       WHERE user_id = ? 
       AND node_id = ? 
       AND node_type = 'page'`,
        [userId, pageId],
      );

      if (existingReport.length > 0) {
        throw new ValidationPageError("You have already reported this page");
      }

      // Create report
      await connection.query(
        `INSERT INTO reports 
       (user_id, node_id, node_type, category_id, reason, time) 
       VALUES (?, ?, 'page', ?, ?, NOW())`,
        [userId, pageId, category_id || null, reason.trim()],
      );

      // Get user info for email
      const [user] = await connection.query(
        "SELECT user_name, user_email, user_firstname, user_lastname FROM users WHERE user_id = ?",
        [userId],
      );

      const [pageCreator] = await connection.query(
        "SELECT user_email, user_firstname, user_lastname FROM users WHERE user_id = ?",
        [page[0].page_admin],
      );

      // Send email notification to admin (you)
      const emailContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #f8f9fa; padding: 20px; border-radius: 5px; }
          .content { padding: 20px; background-color: #fff; border: 1px solid #dee2e6; border-radius: 5px; }
          .info-box { background-color: #f1f8ff; padding: 15px; border-radius: 5px; margin: 15px 0; }
          .footer { margin-top: 20px; font-size: 12px; color: #6c757d; text-align: center; }
          .label { font-weight: bold; color: #495057; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>⚠️ Page Report Notification</h2>
            <p>A user has reported a page that requires your attention.</p>
          </div>
          
          <div class="content">
            <div class="info-box">
              <h3>📋 Report Details</h3>
              <p><span class="label">Reported by:</span> ${user[0]?.user_firstname} ${user[0]?.user_lastname} (${user[0]?.user_email})</p>
              <p><span class="label">Page:</span> ${page[0].page_title} (ID: ${pageId})</p>
              <p><span class="label">Page Creator:</span> ${pageCreator[0]?.user_firstname} ${pageCreator[0]?.user_lastname} (${pageCreator[0]?.user_email})</p>
              <p><span class="label">Report Time:</span> ${new Date().toLocaleString()}</p>
            </div>
            
            <div class="info-box">
              <h3>📝 Reason for Report</h3>
              <p>${reason.trim()}</p>
            </div>
            
            <div class="info-box">
              <h3>🔗 Quick Actions</h3>
              <p>• <a href="${process.env.APP_URL}/admin/pages/${pageId}">View Page in Admin Panel</a></p>
              <p>• <a href="${process.env.APP_URL}/api/admin/reports">View All Reports</a></p>
              <p>• <a href="mailto:${pageCreator[0]?.user_email}">Contact Page Creator</a></p>
            </div>
          </div>
          
          <div class="footer">
            <p>This is an automated notification from ${process.env.APP_NAME || "Your App"}</p>
            <p>Please review this report and take appropriate action.</p>
          </div>
        </div>
      </body>
      </html>
    `;

      // Send email using your email utility
      const emailSent = await sendEmail({
        from: process.env.EMAIL_USERNAME,
        to: process.env.ADMIN_EMAIL || process.env.EMAIL_USERNAME, // Your email
        subject: `🚨 Page Report: ${page[0].page_title}`,
        html: emailContent,
      });

      if (!emailSent) {
        console.warn("Failed to send email notification for page report");
      }

      // Log activity
      await logActivity(
        userId,
        "page_report",
        `Reported page: ${page[0].page_title}`,
        pageId,
        "page",
      );

      res.json({
        success: true,
        message: "Page reported successfully. Our team will review it shortly.",
        data: {
          email_sent: emailSent,
        },
      });
    } catch (error) {
      next(error);
    } finally {
      connection.release();
    }
  }

  static async getReportCategories(req, res, next) {
    const connection = await pool.getConnection();
    try {
      // Fetch all report categories (you can filter by parent_id if needed)
      const [categories] = await connection.query(
        `SELECT category_id, category_name, category_description 
       FROM reports_categories 
       WHERE category_parent_id = 0 
       ORDER BY category_order ASC, category_name ASC`,
      );

      res.json({
        success: true,
        data: categories,
      });
    } catch (error) {
      next(error);
    } finally {
      connection.release();
    }
  }

  // Add these methods to your PagesController class

  // 21. GET SINGLE PAGE POST
  static async getPagePost(req, res, next) {
    try {
      const { pageId, postId } = req.params;
      const userId = this.getCurrentUserId(req);

      // Check if page exists and user can access it
      const [page] = await pool.query(
        "SELECT page_id FROM pages WHERE page_id = ?",
        [pageId],
      );

      if (page.length === 0) {
        throw new PageNotFoundError();
      }

      // Get post with detailed information
      const [posts] = await pool.query(
        `SELECT p.*, 
              pg.page_name, pg.page_title, pg.page_picture,
              COUNT(DISTINCT pr.id) as reactions_count,
              COUNT(DISTINCT pc.comment_id) as comments_count,
              COUNT(DISTINCT ps.post_id) as shares_count
       FROM posts p
       JOIN pages pg ON p.user_id = pg.page_id AND p.user_type = 'page'
       LEFT JOIN posts_reactions pr ON p.post_id = pr.post_id
       LEFT JOIN posts_comments pc ON p.post_id = pc.node_id AND pc.node_type = 'post'
       LEFT JOIN posts ps ON ps.origin_id = p.post_id
       WHERE p.post_id = ? AND p.user_id = ? AND p.user_type = 'page'
       GROUP BY p.post_id`,
        [postId, pageId],
      );

      if (posts.length === 0) {
        throw new PageNotFoundError("Post not found");
      }

      const post = posts[0];

      // Enrich post data based on type
      await PostService.enrichPostData(post, postId, userId);

      // Check if user can view the post (privacy check)
      const privacyCheck = await PostService.getPostPrivacyStatus(
        postId,
        userId,
      );
      if (!privacyCheck.canView) {
        throw new UnauthorizedPageError(privacyCheck.reason);
      }

      // Increment view count if not the owner
      if (userId && !(await this.isUserAdmin(pageId, userId))) {
        await PostService.incrementPostViews(postId, userId);
      }

      res.json({
        success: true,
        data: {
          post: post,
          page_id: pageId,
          can_interact: true, // Page admins can always interact
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 22. TOGGLE PIN POST
  static async togglePinPost(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { pageId, postId } = req.params;
      const userId = this.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Check if user is page admin
      const isAdmin = await this.isUserAdmin(pageId, userId);
      if (!isAdmin) {
        throw new UnauthorizedPageError("Only page admins can pin posts");
      }

      // Check if post exists and belongs to this page
      const [post] = await connection.query(
        "SELECT post_id, user_id FROM posts WHERE post_id = ? AND user_id = ? AND user_type = 'page'",
        [postId, pageId],
      );

      if (post.length === 0) {
        throw new PageNotFoundError("Post not found");
      }

      // Get current pinned post
      const [currentPinned] = await connection.query(
        "SELECT page_pinned_post FROM pages WHERE page_id = ?",
        [pageId],
      );

      let newPinnedPost = null;
      let action = "";

      if (currentPinned[0].page_pinned_post === parseInt(postId)) {
        // Unpin
        await connection.query(
          "UPDATE pages SET page_pinned_post = NULL WHERE page_id = ?",
          [pageId],
        );
        action = "unpinned";
      } else {
        // Pin
        await connection.query(
          "UPDATE pages SET page_pinned_post = ? WHERE page_id = ?",
          [postId, pageId],
        );
        newPinnedPost = postId;
        action = "pinned";
      }

      await connection.commit();

      res.json({
        success: true,
        message: `Post ${action} successfully`,
        data: {
          pinned_post_id: newPinnedPost,
          page_id: pageId,
        },
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 23. GET PINNED POST
  static async getPinnedPost(req, res, next) {
    try {
      const { pageId } = req.params;
      const userId = this.getCurrentUserId(req);

      // Get page's pinned post ID
      const [page] = await pool.query(
        "SELECT page_pinned_post FROM pages WHERE page_id = ?",
        [pageId],
      );

      if (page.length === 0) {
        throw new PageNotFoundError();
      }

      const pinnedPostId = page[0].page_pinned_post;

      if (!pinnedPostId) {
        return res.json({
          success: true,
          data: null,
          message: "No pinned post for this page",
        });
      }

      // Get pinned post details
      const [posts] = await pool.query(
        `SELECT p.*, 
              pg.page_name, pg.page_title, pg.page_picture,
              COUNT(DISTINCT pr.id) as reactions_count,
              COUNT(DISTINCT pc.comment_id) as comments_count,
              COUNT(DISTINCT ps.post_id) as shares_count
       FROM posts p
       JOIN pages pg ON p.user_id = pg.page_id AND p.user_type = 'page'
       LEFT JOIN posts_reactions pr ON p.post_id = pr.post_id
       LEFT JOIN posts_comments pc ON p.post_id = pc.node_id AND pc.node_type = 'post'
       LEFT JOIN posts ps ON ps.origin_id = p.post_id
       WHERE p.post_id = ? AND p.user_id = ? AND p.user_type = 'page'
       GROUP BY p.post_id`,
        [pinnedPostId, pageId],
      );

      if (posts.length === 0) {
        // Clean up invalid pinned post reference
        await pool.query(
          "UPDATE pages SET page_pinned_post = NULL WHERE page_id = ?",
          [pageId],
        );

        return res.json({
          success: true,
          data: null,
          message: "Pinned post not found",
        });
      }

      const post = posts[0];

      // Enrich post data
      await PostService.enrichPostData(post, pinnedPostId, userId);

      // Check privacy
      const privacyCheck = await PostService.getPostPrivacyStatus(
        pinnedPostId,
        userId,
      );
      if (!privacyCheck.canView) {
        throw new UnauthorizedPageError(privacyCheck.reason);
      }

      res.json({
        success: true,
        data: {
          post: post,
          is_pinned: true,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 24. REACT TO POST
  static async reactToPost(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { pageId, postId } = req.params;
      const { reaction = "like" } = req.body;
      const userId = this.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Check if post exists and belongs to this page
      const [post] = await connection.query(
        "SELECT post_id, user_id, user_type FROM posts WHERE post_id = ? AND user_id = ? AND user_type = 'page'",
        [postId, pageId],
      );

      if (post.length === 0) {
        throw new PageNotFoundError("Post not found");
      }

      // Check privacy
      const privacyCheck = await PostService.getPostPrivacyStatus(
        postId,
        userId,
      );
      if (!privacyCheck.canView) {
        throw new UnauthorizedPageError(privacyCheck.reason);
      }

      // Check if valid reaction
      const [validReactions] = await connection.query(
        "SELECT reaction FROM system_reactions WHERE reaction = ? AND enabled = '1'",
        [reaction],
      );

      if (validReactions.length === 0) {
        throw new ValidationPageError("Invalid reaction type");
      }

      // Check if already reacted
      const [existingReaction] = await connection.query(
        "SELECT id, reaction FROM posts_reactions WHERE post_id = ? AND user_id = ?",
        [postId, userId],
      );

      let action = "";
      let currentReaction = reaction;

      if (existingReaction.length > 0) {
        // Update existing reaction
        if (existingReaction[0].reaction === reaction) {
          // Same reaction - remove it
          await connection.query(
            "DELETE FROM posts_reactions WHERE post_id = ? AND user_id = ?",
            [postId, userId],
          );
          action = "removed";
          currentReaction = null;
        } else {
          // Different reaction - update it
          await connection.query(
            "UPDATE posts_reactions SET reaction = ? WHERE post_id = ? AND user_id = ?",
            [reaction, postId, userId],
          );
          action = "updated";
        }
      } else {
        // New reaction
        await connection.query(
          "INSERT INTO posts_reactions (post_id, user_id, reaction, reaction_time) VALUES (?, ?, ?, NOW())",
          [postId, userId, reaction],
        );
        action = "added";
      }

      // Update post reaction counts
      await this.updatePostReactionCounts(connection, postId);

      await connection.commit();

      res.json({
        success: true,
        message: `Reaction ${action} successfully`,
        data: {
          reaction: currentReaction,
          user_id: userId,
          post_id: postId,
        },
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // Helper: Update post reaction counts
  static async updatePostReactionCounts(connection, postId) {
    const [counts] = await connection.query(
      `SELECT 
      SUM(reaction = 'like') as like_count,
      SUM(reaction = 'love') as love_count,
      SUM(reaction = 'haha') as haha_count,
      SUM(reaction = 'yay') as yay_count,
      SUM(reaction = 'wow') as wow_count,
      SUM(reaction = 'sad') as sad_count,
      SUM(reaction = 'angry') as angry_count
     FROM posts_reactions 
     WHERE post_id = ?`,
      [postId],
    );

    if (counts[0]) {
      await connection.query(
        `UPDATE posts SET 
        reaction_like_count = ?,
        reaction_love_count = ?,
        reaction_haha_count = ?,
        reaction_yay_count = ?,
        reaction_wow_count = ?,
        reaction_sad_count = ?,
        reaction_angry_count = ?
       WHERE post_id = ?`,
        [
          counts[0].like_count || 0,
          counts[0].love_count || 0,
          counts[0].haha_count || 0,
          counts[0].yay_count || 0,
          counts[0].wow_count || 0,
          counts[0].sad_count || 0,
          counts[0].angry_count || 0,
          postId,
        ],
      );
    }
  }

  // 25. REMOVE REACTION FROM POST
  static async removeReactionFromPost(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { pageId, postId } = req.params;
      const userId = this.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Check if post exists
      const [post] = await connection.query(
        "SELECT post_id FROM posts WHERE post_id = ? AND user_id = ? AND user_type = 'page'",
        [postId, pageId],
      );

      if (post.length === 0) {
        throw new PageNotFoundError("Post not found");
      }

      // Remove reaction
      const [result] = await connection.query(
        "DELETE FROM posts_reactions WHERE post_id = ? AND user_id = ?",
        [postId, userId],
      );

      if (result.affectedRows === 0) {
        throw new ValidationPageError("No reaction to remove");
      }

      // Update post reaction counts
      await this.updatePostReactionCounts(connection, postId);

      await connection.commit();

      res.json({
        success: true,
        message: "Reaction removed successfully",
        data: {
          user_id: userId,
          post_id: postId,
        },
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 26. COMMENT ON POST
  static async commentOnPost(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { pageId, postId } = req.params;
      const { text, parent_comment_id } = req.body;
      const userId = this.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      if (!text?.trim()) {
        throw new ValidationPageError("Comment text is required");
      }

      // Check if post exists and comments are enabled
      const [post] = await connection.query(
        "SELECT post_id, comments_disabled FROM posts WHERE post_id = ? AND user_id = ? AND user_type = 'page'",
        [postId, pageId],
      );

      if (post.length === 0) {
        throw new PageNotFoundError("Post not found");
      }

      if (post[0].comments_disabled === "1") {
        throw new ValidationPageError("Comments are disabled for this post");
      }

      // Check privacy
      const privacyCheck = await PostService.getPostPrivacyStatus(
        postId,
        userId,
      );
      if (!privacyCheck.canView) {
        throw new UnauthorizedPageError(privacyCheck.reason);
      }

      // Handle file uploads
      let imagePath = null;
      let voiceNotePath = null;

      if (req.files) {
        if (req.files.image && req.files.image[0]) {
          const imageFile = req.files.image[0];
          imageFile.originalname = `comment-image-${Date.now()}-${imageFile.originalname}`;
          const imageData = await storageManager.upload(
            imageFile,
            "comment-images",
          );
          imagePath = imageData.path;
        }

        if (req.files.voice_note && req.files.voice_note[0]) {
          const voiceFile = req.files.voice_note[0];
          voiceFile.originalname = `comment-voice-${Date.now()}-${voiceFile.originalname}`;
          const voiceData = await storageManager.upload(
            voiceFile,
            "comment-voices",
          );
          voiceNotePath = voiceData.path;
        }
      }

      // Determine node type (post or comment)
      const nodeType = parent_comment_id ? "comment" : "post";
      const nodeId = parent_comment_id || postId;

      // Insert comment
      const [result] = await connection.query(
        `INSERT INTO posts_comments 
       (node_id, node_type, user_id, user_type, text, image, voice_note, time) 
       VALUES (?, ?, ?, 'user', ?, ?, ?, NOW())`,
        [nodeId, nodeType, userId, text.trim(), imagePath, voiceNotePath],
      );

      const commentId = result.insertId;

      // Update post comment count
      if (nodeType === "post") {
        await connection.query(
          "UPDATE posts SET comments = comments + 1 WHERE post_id = ?",
          [postId],
        );
      } else {
        // Update parent comment replies count
        await connection.query(
          "UPDATE posts_comments SET replies = replies + 1 WHERE comment_id = ?",
          [parent_comment_id],
        );
      }

      // Handle mentions in comment
      await this.handleMentions(connection, commentId, text, userId, "user");

      // Get comment with user info
      const [comments] = await connection.query(
        `SELECT pc.*, 
        u.user_id, u.user_name, u.user_firstname, u.user_lastname, u.user_picture
       FROM posts_comments pc
       JOIN users u ON pc.user_id = u.user_id
       WHERE pc.comment_id = ?`,
        [commentId],
      );

      const comment = comments[0];

      // Send notification to post owner (page admins)
      const [pageAdmins] = await connection.query(
        "SELECT user_id FROM pages_admins WHERE page_id = ? AND user_id != ?",
        [pageId, userId],
      );

      for (const admin of pageAdmins) {
        await connection.query(
          `INSERT INTO notifications 
         (to_user_id, from_user_id, from_user_type, action, node_type, node_url, time) 
         VALUES (?, ?, 'user', 'commented_on_post', 'post', ?, NOW())`,
          [admin.user_id, userId, `/post/${postId}#comment-${commentId}`],
        );
      }

      await connection.commit();

      res.status(201).json({
        success: true,
        message: "Comment added successfully",
        data: {
          comment: comment,
          comment_id: commentId,
          post_id: postId,
        },
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 27. GET POST COMMENTS
  static async getPostComments(req, res, next) {
    try {
      const { pageId, postId } = req.params;
      const {
        parent_comment_id = null,
        limit = 20,
        offset = 0,
        sort = "newest",
      } = req.query;
      const userId = this.getCurrentUserId(req);

      // Check if post exists
      const [post] = await pool.query(
        "SELECT post_id FROM posts WHERE post_id = ? AND user_id = ? AND user_type = 'page'",
        [postId, pageId],
      );

      if (post.length === 0) {
        throw new PageNotFoundError("Post not found");
      }

      // Determine sort order
      let orderBy = "pc.time DESC";
      if (sort === "oldest") {
        orderBy = "pc.time ASC";
      } else if (sort === "top") {
        orderBy = "pc.reaction_like_count DESC, pc.time DESC";
      }

      // Build query
      const whereClauses = ["pc.node_id = ?", "pc.node_type = ?"];
      const queryParams = [
        parent_comment_id || postId,
        parent_comment_id ? "comment" : "post",
      ];

      // Get comments
      const [comments] = await pool.query(
        `SELECT pc.*, 
        u.user_id, u.user_name, u.user_firstname, u.user_lastname, u.user_picture,
        COUNT(DISTINCT pcr.id) as replies_count,
        COUNT(DISTINCT pcrr.id) as comment_reactions_count
       FROM posts_comments pc
       JOIN users u ON pc.user_id = u.user_id
       LEFT JOIN posts_comments pcr ON pc.comment_id = pcr.node_id AND pcr.node_type = 'comment'
       LEFT JOIN posts_comments_reactions pcrr ON pc.comment_id = pcrr.comment_id
       WHERE ${whereClauses.join(" AND ")}
       GROUP BY pc.comment_id
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
        [...queryParams, parseInt(limit), parseInt(offset)],
      );

      // Get user reactions if logged in
      if (userId) {
        for (const comment of comments) {
          const [userReaction] = await pool.query(
            "SELECT reaction FROM posts_comments_reactions WHERE comment_id = ? AND user_id = ?",
            [comment.comment_id, userId],
          );
          comment.user_reaction = userReaction[0] || null;
        }
      }

      // Get total count
      const [totalResult] = await pool.query(
        `SELECT COUNT(*) as total 
       FROM posts_comments pc 
       WHERE ${whereClauses.join(" AND ")}`,
        queryParams,
      );

      res.json({
        success: true,
        data: {
          comments: comments,
          pagination: {
            page: Math.floor(offset / limit) + 1,
            limit: parseInt(limit),
            total: totalResult[0]?.total || 0,
            pages: Math.ceil((totalResult[0]?.total || 0) / limit),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 28. GET POST REACTIONS
  static async getPostReactions(req, res, next) {
    try {
      const { pageId, postId } = req.params;
      const {
        reaction = null, // filter by specific reaction
        limit = 50,
        offset = 0,
      } = req.query;
      const userId = this.getCurrentUserId(req);

      // Check if post exists
      const [post] = await pool.query(
        "SELECT post_id FROM posts WHERE post_id = ? AND user_id = ? AND user_type = 'page'",
        [postId, pageId],
      );

      if (post.length === 0) {
        throw new PageNotFoundError("Post not found");
      }

      // Build query
      const whereClauses = ["pr.post_id = ?"];
      const queryParams = [postId];

      if (reaction) {
        whereClauses.push("pr.reaction = ?");
        queryParams.push(reaction);
      }

      // Get reactions with user info
      const [reactions] = await pool.query(
        `SELECT pr.*, 
        sr.title as reaction_title, sr.image as reaction_image, sr.color as reaction_color,
        u.user_id, u.user_name, u.user_firstname, u.user_lastname, u.user_picture,
        u.user_verified
       FROM posts_reactions pr
       LEFT JOIN system_reactions sr ON pr.reaction = sr.reaction
       JOIN users u ON pr.user_id = u.user_id
       WHERE ${whereClauses.join(" AND ")}
       ORDER BY pr.reaction_time DESC
       LIMIT ? OFFSET ?`,
        [...queryParams, parseInt(limit), parseInt(offset)],
      );

      // Get reaction summary
      const [summary] = await pool.query(
        `SELECT pr.reaction, 
        COUNT(*) as count,
        sr.title as reaction_title,
        sr.image as reaction_image,
        sr.color as reaction_color
       FROM posts_reactions pr
       LEFT JOIN system_reactions sr ON pr.reaction = sr.reaction
       WHERE pr.post_id = ?
       GROUP BY pr.reaction
       ORDER BY count DESC`,
        [postId],
      );

      // Get total count
      const [totalResult] = await pool.query(
        `SELECT COUNT(*) as total 
       FROM posts_reactions pr 
       WHERE ${whereClauses.join(" AND ")}`,
        queryParams,
      );

      res.json({
        success: true,
        data: {
          reactions: reactions,
          summary: summary,
          pagination: {
            page: Math.floor(offset / limit) + 1,
            limit: parseInt(limit),
            total: totalResult[0]?.total || 0,
            pages: Math.ceil((totalResult[0]?.total || 0) / limit),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 29. GET POST SHARES
  static async getPostShares(req, res, next) {
    try {
      const { pageId, postId } = req.params;
      const { limit = 20, offset = 0 } = req.query;
      const userId = this.getCurrentUserId(req);

      // Check if post exists
      const [post] = await pool.query(
        "SELECT post_id FROM posts WHERE post_id = ? AND user_id = ? AND user_type = 'page'",
        [postId, pageId],
      );

      if (post.length === 0) {
        throw new PageNotFoundError("Post not found");
      }

      // Get shares
      const [shares] = await pool.query(
        `SELECT ps.*, 
        u.user_id, u.user_name, u.user_firstname, u.user_lastname, u.user_picture,
        pg.page_id, pg.page_name, pg.page_title, pg.page_picture,
        COUNT(DISTINCT psr.id) as shares_reactions_count,
        COUNT(DISTINCT psc.comment_id) as shares_comments_count
       FROM posts ps
       LEFT JOIN users u ON ps.user_id = u.user_id AND ps.user_type = 'user'
       LEFT JOIN pages pg ON ps.user_id = pg.page_id AND ps.user_type = 'page'
       LEFT JOIN posts_reactions psr ON ps.post_id = psr.post_id
       LEFT JOIN posts_comments psc ON ps.post_id = psc.node_id AND psc.node_type = 'post'
       WHERE ps.origin_id = ?
       GROUP BY ps.post_id
       ORDER BY ps.time DESC
       LIMIT ? OFFSET ?`,
        [postId, parseInt(limit), parseInt(offset)],
      );

      // Get total count
      const [totalResult] = await pool.query(
        "SELECT COUNT(*) as total FROM posts WHERE origin_id = ?",
        [postId],
      );

      res.json({
        success: true,
        data: {
          shares: shares,
          pagination: {
            page: Math.floor(offset / limit) + 1,
            limit: parseInt(limit),
            total: totalResult[0]?.total || 0,
            pages: Math.ceil((totalResult[0]?.total || 0) / limit),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 30. TOGGLE SAVE POST
  static async toggleSavePost(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { pageId, postId } = req.params;
      const userId = this.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Check if post exists
      const [post] = await connection.query(
        "SELECT post_id FROM posts WHERE post_id = ? AND user_id = ? AND user_type = 'page'",
        [postId, pageId],
      );

      if (post.length === 0) {
        throw new PageNotFoundError("Post not found");
      }

      // Check if already saved
      const [existingSave] = await connection.query(
        "SELECT id FROM posts_saved WHERE post_id = ? AND user_id = ?",
        [postId, userId],
      );

      let action = "";

      if (existingSave.length > 0) {
        // Unsave
        await connection.query(
          "DELETE FROM posts_saved WHERE post_id = ? AND user_id = ?",
          [postId, userId],
        );
        action = "unsaved";
      } else {
        // Save
        await connection.query(
          "INSERT INTO posts_saved (post_id, user_id, time) VALUES (?, ?, NOW())",
          [postId, userId],
        );
        action = "saved";
      }

      await connection.commit();

      res.json({
        success: true,
        message: `Post ${action} successfully`,
        data: {
          saved: action === "saved",
          post_id: postId,
          user_id: userId,
        },
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 31. SHARE POST
  static async sharePost(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { pageId, postId } = req.params;
      const {
        text = "",
        privacy = "public",
        share_to_profile = "1",
        share_to_page = "0",
        target_page_id = null,
      } = req.body;

      const userId = this.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Check if post exists and can be shared
      const [originalPost] = await connection.query(
        `SELECT p.*, pg.page_name, pg.page_title
       FROM posts p
       LEFT JOIN pages pg ON p.user_id = pg.page_id AND p.user_type = 'page'
       WHERE p.post_id = ?`,
        [postId],
      );

      if (originalPost.length === 0) {
        throw new PageNotFoundError("Post not found");
      }

      // Check privacy
      const privacyCheck = await PostService.getPostPrivacyStatus(
        postId,
        userId,
      );
      if (!privacyCheck.canView) {
        throw new UnauthorizedPageError(privacyCheck.reason);
      }

      let sharedPostId = null;

      // Share to user profile
      if (share_to_profile === "1") {
        const [shareResult] = await connection.query(
          `INSERT INTO posts (
          user_id, user_type, post_type, text, privacy, origin_id, time
        ) VALUES (?, 'user', ?, ?, ?, ?, NOW())`,
          [userId, "share", text.trim(), privacy, postId],
        );

        sharedPostId = shareResult.insertId;

        // Increment shares count on original post
        await connection.query(
          "UPDATE posts SET shares = shares + 1 WHERE post_id = ?",
          [postId],
        );
      }

      // Share to page
      if (share_to_page === "1" && target_page_id) {
        // Check if user is admin of target page
        const isAdmin = await this.isUserAdmin(target_page_id, userId);
        if (!isAdmin) {
          throw new UnauthorizedPageError(
            "You must be an admin to share to this page",
          );
        }

        const [pageShareResult] = await connection.query(
          `INSERT INTO posts (
          user_id, user_type, post_type, text, privacy, origin_id, time
        ) VALUES (?, 'page', ?, ?, ?, ?, NOW())`,
          [target_page_id, "share", text.trim(), privacy, postId],
        );

        // Increment shares count again if sharing to both places
        if (share_to_profile === "1") {
          await connection.query(
            "UPDATE posts SET shares = shares + 1 WHERE post_id = ?",
            [postId],
          );
        } else {
          await connection.query(
            "UPDATE posts SET shares = shares + 1 WHERE post_id = ?",
            [postId],
          );
        }
      }

      // Get shared post details
      let sharedPost = null;
      if (sharedPostId) {
        const [posts] = await connection.query(
          `SELECT p.*, 
          u.user_name, u.user_firstname, u.user_lastname, u.user_picture
         FROM posts p
         LEFT JOIN users u ON p.user_id = u.user_id AND p.user_type = 'user'
         WHERE p.post_id = ?`,
          [sharedPostId],
        );
        sharedPost = posts[0];
      }

      await connection.commit();

      res.status(201).json({
        success: true,
        message: "Post shared successfully",
        data: {
          share_id: sharedPostId,
          shared_post: sharedPost,
          original_post_id: postId,
        },
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 32. GET BLOG CATEGORIES
  static async getBlogCategories(req, res, next) {
    try {
      const { parent_id = 0 } = req.query;

      const [categories] = await pool.query(
        `SELECT category_id, category_parent_id, category_name, 
              category_description, category_order
       FROM blogs_categories
       WHERE category_parent_id = ?
       ORDER BY category_order ASC, category_name ASC`,
        [parent_id],
      );

      // Get subcategories count for each category
      for (let category of categories) {
        const [subCount] = await pool.query(
          "SELECT COUNT(*) as count FROM blogs_categories WHERE category_parent_id = ?",
          [category.category_id],
        );
        category.has_subcategories = subCount[0]?.count > 0;
      }

      res.json({
        success: true,
        data: categories,
      });
    } catch (error) {
      next(error);
    }
  }

  // 33. GET JOB CATEGORIES
  static async getJobCategories(req, res, next) {
    try {
      const { parent_id = 0 } = req.query;

      const [categories] = await pool.query(
        `SELECT category_id, category_parent_id, category_name, 
              category_description, category_order
       FROM jobs_categories
       WHERE category_parent_id = ?
       ORDER BY category_order ASC, category_name ASC`,
        [parent_id],
      );

      // Get subcategories count for each category
      for (let category of categories) {
        const [subCount] = await pool.query(
          "SELECT COUNT(*) as count FROM jobs_categories WHERE category_parent_id = ?",
          [category.category_id],
        );
        category.has_subcategories = subCount[0]?.count > 0;
      }

      res.json({
        success: true,
        data: categories,
      });
    } catch (error) {
      next(error);
    }
  }

  // 34. GET MARKET CATEGORIES
  static async getMarketCategories(req, res, next) {
    try {
      const { parent_id = 0 } = req.query;

      const [categories] = await pool.query(
        `SELECT category_id, category_parent_id, category_name, 
              category_description, category_order
       FROM market_categories
       WHERE category_parent_id = ?
       ORDER BY category_order ASC, category_name ASC`,
        [parent_id],
      );

      // Get subcategories count for each category
      for (let category of categories) {
        const [subCount] = await pool.query(
          "SELECT COUNT(*) as count FROM market_categories WHERE category_parent_id = ?",
          [category.category_id],
        );
        category.has_subcategories = subCount[0]?.count > 0;
      }

      res.json({
        success: true,
        data: categories,
      });
    } catch (error) {
      next(error);
    }
  }

  // 35. GET OFFERS CATEGORIES
  static async getOffersCategories(req, res, next) {
    try {
      const { parent_id = 0 } = req.query;

      const [categories] = await pool.query(
        `SELECT category_id, category_parent_id, category_name, 
              category_description, category_order
       FROM offers_categories
       WHERE category_parent_id = ?
       ORDER BY category_order ASC, category_name ASC`,
        [parent_id],
      );

      // Get subcategories count for each category
      for (let category of categories) {
        const [subCount] = await pool.query(
          "SELECT COUNT(*) as count FROM offers_categories WHERE category_parent_id = ?",
          [category.category_id],
        );
        category.has_subcategories = subCount[0]?.count > 0;
      }

      res.json({
        success: true,
        data: categories,
      });
    } catch (error) {
      next(error);
    }
  }

  // 36. GET COLORED PATTERNS
  static async getColoredPatterns(req, res, next) {
    try {
      const { type = null } = req.query;

      const whereClauses = [];
      const queryParams = [];

      if (type) {
        whereClauses.push("type = ?");
        queryParams.push(type);
      }

      const whereSQL =
        whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

      const [patterns] = await pool.query(
        `SELECT pattern_id, type, background_image, 
              background_color_1, background_color_2, text_color
       FROM posts_colored_patterns
       ${whereSQL}
       ORDER BY pattern_id ASC`,
        queryParams,
      );

      res.json({
        success: true,
        data: patterns,
      });
    } catch (error) {
      next(error);
    }
  }

  // 37. GET SYSTEM REACTIONS
  static async getSystemReactions(req, res, next) {
    try {
      const [reactions] = await pool.query(
        `SELECT reaction_id, reaction, title, color, image, 
              reaction_order, enabled
       FROM system_reactions
       WHERE enabled = '1'
       ORDER BY reaction_order ASC, title ASC`,
      );

      res.json({
        success: true,
        data: reactions,
      });
    } catch (error) {
      next(error);
    }
  }

  // 38. GET SAVED POSTS
  static async getSavedPosts(req, res, next) {
    try {
      const { limit = 20, offset = 0 } = req.query;
      const userId = this.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Get saved posts
      const [savedPosts] = await pool.query(
        `SELECT ps.*, 
        p.*,
        u.user_name, u.user_firstname, u.user_lastname, u.user_picture,
        pg.page_name, pg.page_title, pg.page_picture,
        ps.time as saved_time
       FROM posts_saved ps
       JOIN posts p ON ps.post_id = p.post_id
       LEFT JOIN users u ON p.user_id = u.user_id AND p.user_type = 'user'
       LEFT JOIN pages pg ON p.user_id = pg.page_id AND p.user_type = 'page'
       WHERE ps.user_id = ?
       ORDER BY ps.time DESC
       LIMIT ? OFFSET ?`,
        [userId, parseInt(limit), parseInt(offset)],
      );

      // Enrich each post
      for (const savedPost of savedPosts) {
        await PostService.enrichPostData(savedPost, savedPost.post_id, userId);
      }

      // Get total count
      const [totalResult] = await pool.query(
        "SELECT COUNT(*) as total FROM posts_saved WHERE user_id = ?",
        [userId],
      );

      res.json({
        success: true,
        data: {
          saved_posts: savedPosts,
          pagination: {
            page: Math.floor(offset / limit) + 1,
            limit: parseInt(limit),
            total: totalResult[0]?.total || 0,
            pages: Math.ceil((totalResult[0]?.total || 0) / limit),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 39. GET COUNTRIES (already implemented but adding better version)
  static async getCountries(req, res, next) {
    try {
      const { enabled = "1" } = req.query;

      const whereClauses = ["enabled = ?"];
      const queryParams = [enabled];

      const [countries] = await pool.query(
        `SELECT country_id, country_code, country_name, 
              phone_code, country_vat, country_order
       FROM system_countries
       WHERE ${whereClauses.join(" AND ")}
       ORDER BY country_order ASC, country_name ASC`,
        queryParams,
      );

      res.json({
        success: true,
        data: countries,
      });
    } catch (error) {
      next(error);
    }
  }

  // 40. GET REPORT CATEGORIES (already implemented but adding better version)
  static async getReportCategories(req, res, next) {
    try {
      const { parent_id = 0 } = req.query;

      const [categories] = await pool.query(
        `SELECT category_id, category_parent_id, category_name, 
              category_description, category_order
       FROM reports_categories
       WHERE category_parent_id = ?
       ORDER BY category_order ASC, category_name ASC`,
        [parent_id],
      );

      // Get subcategories count for each category
      for (let category of categories) {
        const [subCount] = await pool.query(
          "SELECT COUNT(*) as count FROM reports_categories WHERE category_parent_id = ?",
          [category.category_id],
        );
        category.has_subcategories = subCount[0]?.count > 0;
      }

      res.json({
        success: true,
        data: categories,
      });
    } catch (error) {
      next(error);
    }
  }

  // 41. DELETE COMMENT (additional useful method)
  static async deleteComment(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { pageId, postId, commentId } = req.params;
      const userId = this.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Check if comment exists and belongs to this post/page
      const [comment] = await connection.query(
        `SELECT pc.*, p.user_id as page_id
       FROM posts_comments pc
       JOIN posts p ON pc.node_id = p.post_id
       WHERE pc.comment_id = ? 
       AND pc.node_id = ? 
       AND pc.node_type = 'post'
       AND p.user_id = ? 
       AND p.user_type = 'page'`,
        [commentId, postId, pageId],
      );

      if (comment.length === 0) {
        throw new PageNotFoundError("Comment not found");
      }

      // Check if user can delete (must be comment owner, post owner, or page admin)
      const isCommentOwner = comment[0].user_id === userId;
      const isPageAdmin = await this.isUserAdmin(pageId, userId);

      if (!isCommentOwner && !isPageAdmin) {
        throw new UnauthorizedPageError(
          "Not authorized to delete this comment",
        );
      }

      // Delete comment and its replies
      await connection.query(
        "DELETE FROM posts_comments WHERE comment_id = ?",
        [commentId],
      );

      // Also delete any replies to this comment
      await connection.query(
        "DELETE FROM posts_comments WHERE node_id = ? AND node_type = 'comment'",
        [commentId],
      );

      // Update post comment count
      await connection.query(
        "UPDATE posts SET comments = comments - 1 WHERE post_id = ?",
        [postId],
      );

      await connection.commit();

      res.json({
        success: true,
        message: "Comment deleted successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 42. REACT TO COMMENT
  static async reactToComment(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { pageId, postId, commentId } = req.params;
      const { reaction = "like" } = req.body;
      const userId = this.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedPageError("Authentication required");
      }

      // Check if comment exists
      const [comment] = await connection.query(
        `SELECT pc.*, p.user_id as page_id
       FROM posts_comments pc
       JOIN posts p ON pc.node_id = p.post_id
       WHERE pc.comment_id = ? 
       AND pc.node_id = ? 
       AND pc.node_type = 'post'
       AND p.user_id = ? 
       AND p.user_type = 'page'`,
        [commentId, postId, pageId],
      );

      if (comment.length === 0) {
        throw new PageNotFoundError("Comment not found");
      }

      // Check if valid reaction
      const [validReactions] = await connection.query(
        "SELECT reaction FROM system_reactions WHERE reaction = ? AND enabled = '1'",
        [reaction],
      );

      if (validReactions.length === 0) {
        throw new ValidationPageError("Invalid reaction type");
      }

      // Check if already reacted
      const [existingReaction] = await connection.query(
        "SELECT id, reaction FROM posts_comments_reactions WHERE comment_id = ? AND user_id = ?",
        [commentId, userId],
      );

      let action = "";
      let currentReaction = reaction;

      if (existingReaction.length > 0) {
        // Update existing reaction
        if (existingReaction[0].reaction === reaction) {
          // Same reaction - remove it
          await connection.query(
            "DELETE FROM posts_comments_reactions WHERE comment_id = ? AND user_id = ?",
            [commentId, userId],
          );
          action = "removed";
          currentReaction = null;
        } else {
          // Different reaction - update it
          await connection.query(
            "UPDATE posts_comments_reactions SET reaction = ? WHERE comment_id = ? AND user_id = ?",
            [reaction, commentId, userId],
          );
          action = "updated";
        }
      } else {
        // New reaction
        await connection.query(
          "INSERT INTO posts_comments_reactions (comment_id, user_id, reaction, reaction_time) VALUES (?, ?, ?, NOW())",
          [commentId, userId, reaction],
        );
        action = "added";
      }

      // Update comment reaction counts
      await this.updateCommentReactionCounts(connection, commentId);

      await connection.commit();

      res.json({
        success: true,
        message: `Reaction ${action} successfully`,
        data: {
          reaction: currentReaction,
          user_id: userId,
          comment_id: commentId,
        },
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // Helper: Update comment reaction counts
  static async updateCommentReactionCounts(connection, commentId) {
    const [counts] = await connection.query(
      `SELECT 
      SUM(reaction = 'like') as like_count,
      SUM(reaction = 'love') as love_count,
      SUM(reaction = 'haha') as haha_count,
      SUM(reaction = 'yay') as yay_count,
      SUM(reaction = 'wow') as wow_count,
      SUM(reaction = 'sad') as sad_count,
      SUM(reaction = 'angry') as angry_count
     FROM posts_comments_reactions 
     WHERE comment_id = ?`,
      [commentId],
    );

    if (counts[0]) {
      await connection.query(
        `UPDATE posts_comments SET 
        reaction_like_count = ?,
        reaction_love_count = ?,
        reaction_haha_count = ?,
        reaction_yay_count = ?,
        reaction_wow_count = ?,
        reaction_sad_count = ?,
        reaction_angry_count = ?
       WHERE comment_id = ?`,
        [
          counts[0].like_count || 0,
          counts[0].love_count || 0,
          counts[0].haha_count || 0,
          counts[0].yay_count || 0,
          counts[0].wow_count || 0,
          counts[0].sad_count || 0,
          counts[0].angry_count || 0,
          commentId,
        ],
      );
    }
  }
}

module.exports = PagesController;
