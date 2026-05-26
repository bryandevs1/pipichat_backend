const pool = require("../config/db");
const { logActivity } = require("../services/activityLogger");
const storageManager = require("../utils/storageManager");
const path = require("path");
const fs = require("fs").promises; // Use promises version
// Custom Errors
class GroupError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
  }
}

class GroupNotFoundError extends GroupError {
  constructor(message = "Group not found") {
    super(message, 404);
  }
}

class UnauthorizedError extends GroupError {
  constructor(message = "Unauthorized access") {
    super(message, 403);
  }
}

class ValidationError extends GroupError {
  constructor(message = "Validation failed") {
    super(message, 400);
  }
}

const handleBase64Upload = async (base64String, filename, folder) => {
  try {
    const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);

    if (!matches || matches.length !== 3) {
      throw new Error("Invalid base64 string");
    }

    const mimeType = matches[1];
    const buffer = Buffer.from(matches[2], "base64");

    // Ensure filename has extension
    const extension = mimeType.split("/")[1] || "jpg";
    const fullFilename = filename.includes(".")
      ? filename
      : `${filename}.${extension}`;

    // Create a temporary file
    const tempPath = path.join("/tmp", fullFilename);
    await fs.writeFile(tempPath, buffer);

    // Create a file-like object
    const file = {
      path: tempPath,
      originalname: fullFilename,
      mimetype: mimeType,
      size: buffer.length,
      buffer: buffer, // Add buffer in case storageManager needs it
    };

    const result = await storageManager.upload(file, folder);

    // Clean up temp file
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

class GroupController {
  // Add this helper method to GroupController
  static async ensurePostsHaveUserInfo(posts) {
    if (!posts || posts.length === 0) return posts;

    const userIds = [
      ...new Set(posts.map((p) => p.user_id).filter((id) => id)),
    ];

    if (userIds.length === 0) return posts;

    const [users] = await pool.query(
      `SELECT user_id, user_name, user_firstname, user_lastname, user_picture, user_verified 
     FROM users WHERE user_id IN (?)`,
      [userIds]
    );

    const userMap = {};
    users.forEach((user) => {
      userMap[user.user_id] = user;
    });

    return posts.map((post) => {
      if (post.user_id && userMap[post.user_id]) {
        return {
          ...post,
          user_name: userMap[post.user_id].user_name,
          user_firstname: userMap[post.user_id].user_firstname,
          user_lastname: userMap[post.user_id].user_lastname,
          user_picture: userMap[post.user_id].user_picture,
          user_verified: userMap[post.user_id].user_verified,
        };
      }
      return post;
    });
  }

  static determinePostType(req) {
    if (req.files && req.files.photos && req.files.photos.length > 0)
      return "photo";
    if (req.files && req.files.videos && req.files.videos.length > 0)
      return "video";
    if (req.files && req.files.files && req.files.files.length > 0)
      return "file";
    if (req.body.link) return "link";
    if (req.body.text && req.body.text.trim()) return "text";
    return "text";
  }
  // Helper: Get current user
  // Helper: Get current user
  static getCurrentUserId(req) {
    // Try multiple possible locations for user ID
    return (
      req.user?.id ||
      req.user?.user_id ||
      req.user?.uid ||
      req.userId ||
      req.user?.user_id ||
      (req.headers.authorization
        ? req.headers.authorization.split(" ")[1]
        : null) || // JWT token
      null
    );
  }

  // Helper: Check if user is member
  static async isUserMember(groupId, userId) {
    if (!userId) return false;
    const [membership] = await pool.query(
      `SELECT 1 FROM groups_members 
       WHERE group_id = ? AND user_id = ? AND approved = '1'`,
      [groupId, userId]
    );
    return membership.length > 0;
  }

  // Helper: Check if user is admin
  static async isUserAdmin(groupId, userId) {
    if (!userId) return false;
    const [admin] = await pool.query(
      `SELECT 1 FROM groups_admins 
       WHERE group_id = ? AND user_id = ?`,
      [groupId, userId]
    );
    return admin.length > 0;
  }

  // Helper: Check if user is creator
  static async isUserCreator(groupId, userId) {
    const [group] = await pool.query(
      "SELECT group_admin FROM `groups` WHERE group_id = ?",
      [groupId]
    );
    return group.length > 0 && group[0].group_admin === userId;
  }

  // Helper: Get group privacy
  static async getGroupPrivacy(groupId) {
    const [group] = await pool.query(
      "SELECT group_privacy FROM `groups` WHERE group_id = ?",
      [groupId]
    );
    return group.length > 0 ? group[0].group_privacy : null;
  }

  // Helper: Handle single file upload
  static async handleFileUpload(file, folder) {
    if (!file) return null;

    try {
      // Ensure the file has the necessary properties
      if (!file.originalname) {
        file.originalname = `file-${Date.now()}.jpg`;
      }

      const result = await storageManager.upload(file, folder);
      return result;
    } catch (error) {
      console.error("File upload error:", error);
      throw new ValidationError(`Failed to upload file: ${error.message}`);
    }
  }

  // Helper: Delete old files when updating
  static async deleteOldFile(storageType, path) {
    if (!storageType || !path) return;

    try {
      await storageManager.deleteFile(storageType, path);
    } catch (error) {
      console.error("Failed to delete old file:", error.message);
      // Don't throw - continue with update even if delete fails
    }
  }
  // 1. CREATE GROUP
  // Add this at the top of groupController.js

  // Update the createGroup method
  static async createGroup(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const userId = GroupController.getCurrentUserId(req);
      if (!userId) {
        throw new UnauthorizedError("Authentication required");
      }

      const {
        group_name,
        group_title,
        group_description,
        group_privacy = "public",
        group_category,
        group_cover_position,
        publish_enabled = "1",
        publish_approval_enabled = "0",
        chatbox_enabled = "0",
        monetization_enabled = "0",
        monetization_min_price = 0,
        monetization_plans = 0,
        location,
        country_id,
        rules,
      } = req.body;

      // Validate group name format
      if (!/^[a-z0-9_-]{3,64}$/i.test(group_name)) {
        throw new ValidationError(
          "Group name must be 3-64 characters, alphanumeric with underscores or hyphens"
        );
      }

      // Check uniqueness
      const [existing] = await connection.query(
        "SELECT 1 FROM `groups` WHERE group_name = ?",
        [group_name]
      );

      if (existing.length > 0) {
        throw new ValidationError("Group name already taken", 409);
      }

      // Handle group picture upload
      let groupPictureData = null;
      let groupCoverData = null;

      if (req.files) {
        if (req.files.group_picture && req.files.group_picture[0]) {
          const pictureFile = req.files.group_picture[0];
          pictureFile.originalname = `group-picture-${Date.now()}-${
            pictureFile.originalname
          }`;

          groupPictureData = await storageManager.upload(
            pictureFile,
            "group-pictures"
          );

          // Optional: Clean up temp file if storageManager doesn't do it automatically
          if (pictureFile.path && pictureFile.path.startsWith("/tmp/")) {
            try {
              await fs.unlink(pictureFile.path);
            } catch (err) {
              console.log("Failed to delete temp file:", err.message);
            }
          }
        }

        if (req.files.group_cover && req.files.group_cover[0]) {
          const coverFile = req.files.group_cover[0];
          coverFile.originalname = `group-cover-${Date.now()}-${
            coverFile.originalname
          }`;

          groupCoverData = await storageManager.upload(
            coverFile,
            "group-covers"
          );

          // Optional: Clean up temp file
          if (coverFile.path && coverFile.path.startsWith("/tmp/")) {
            try {
              await fs.unlink(coverFile.path);
            } catch (err) {
              console.log("Failed to delete temp file:", err.message);
            }
          }
        }
      }

      // Create group
      const [result] = await connection.query(
        `INSERT INTO \`groups\` (
        group_name, group_title, group_description, group_privacy,
        group_admin, group_category, group_publish_enabled,
        group_publish_approval_enabled, group_picture, group_picture_id,
        group_cover, group_cover_id, group_cover_position,
        chatbox_enabled, group_monetization_enabled, group_monetization_min_price,
        group_monetization_plans, group_members, group_date
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
        [
          group_name,
          group_title,
          group_description || null,
          group_privacy,
          userId,
          group_category || null,
          publish_enabled,
          publish_approval_enabled,
          groupPictureData ? groupPictureData.path : null,
          groupPictureData ? groupPictureData.filename : null,
          groupCoverData ? groupCoverData.path : null,
          groupCoverData ? groupCoverData.filename : null,
          group_cover_position || null,
          chatbox_enabled,
          monetization_enabled,
          monetization_min_price,
          monetization_plans,
          1, // creator is first member
        ]
      );

      const groupId = result.insertId;

      // Store storage data in separate table if needed, or as JSON in groups table
      if (groupPictureData || groupCoverData) {
        await connection.query(
          `INSERT INTO group_storage_data (
          group_id, picture_storage_type, picture_storage_data,
          cover_storage_type, cover_storage_data, created_at
        ) VALUES (?, ?, ?, ?, ?, NOW())`,
          [
            groupId,
            groupPictureData ? groupPictureData.storage_type : null,
            groupPictureData ? groupPictureData.storage_data : null,
            groupCoverData ? groupCoverData.storage_type : null,
            groupCoverData ? groupCoverData.storage_data : null,
          ]
        );
      }

      // Add creator as admin & member
      await connection.query(
        "INSERT INTO groups_admins (group_id, user_id) VALUES (?, ?)",
        [groupId, userId]
      );

      await connection.query(
        "INSERT INTO groups_members (group_id, user_id, approved) VALUES (?, ?, ?)",
        [groupId, userId, "1"]
      );

      // Create default photo albums using existing posts_photos_albums table
      await connection.query(
        `INSERT INTO posts_photos_albums 
       (title, user_id, user_type, in_group, group_id, privacy) 
       VALUES 
       ('Group Pictures', ?, 'user', '1', ?, 'public'),
       ('Group Covers', ?, 'user', '1', ?, 'public'),
       ('Group Timeline', ?, 'user', '1', ?, 'public')`,
        [userId, groupId, userId, groupId, userId, groupId]
      );

      await connection.commit();

      // Generate public URLs for response
      const groupPictureUrl = groupPictureData
        ? groupPictureData.public_url
        : null;
      const groupCoverUrl = groupCoverData ? groupCoverData.public_url : null;

      res.status(201).json({
        success: true,
        message: "Group created successfully",
        data: {
          group_id: groupId,
          group_name,
          group_title,
          group_privacy,
          group_picture_url: groupPictureUrl,
          group_cover_url: groupCoverUrl,
          url: `/groups/${groupId}`,
        },
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 2. GET GROUP DETAILS
  // 2. GET GROUP DETAILS
  static async getGroup(req, res, next) {
    try {
      const { groupId } = req.params;
      const userId = GroupController.getCurrentUserId(req);
      console.log("req.user object:", JSON.stringify(req.user, null, 2));
      console.log("req.user?.id:", req.user?.id);
      console.log("req.user?.user_id:", req.user?.user_id);
      console.log("req.userId:", req.userId);
      console.log("getGroup called with:", { groupId, userId });

      // First check if group exists
      const [groupExists] = await pool.query(
        "SELECT 1 FROM `groups` WHERE group_id = ?",
        [groupId]
      );

      if (groupExists.length === 0) {
        throw new GroupNotFoundError();
      }

      // Get group with category info - FIXED QUERY
      const [groups] = await pool.query(
        `SELECT 
        g.*,
        gc.category_name,
        gc.category_parent_id,
        (SELECT COUNT(*) FROM groups_members gm 
         WHERE gm.group_id = g.group_id AND gm.approved = '1') as active_members,
        (SELECT COUNT(*) FROM groups_admins ga 
         WHERE ga.group_id = g.group_id) as admin_count,
        (SELECT user_name FROM users u 
         WHERE u.user_id = g.group_admin) as creator_username,
        (SELECT user_picture FROM users u 
         WHERE u.user_id = g.group_admin) as creator_picture
       FROM \`groups\` g
       LEFT JOIN groups_categories gc ON gc.category_id = g.group_category
       WHERE g.group_id = ?
       AND NOT g.group_title LIKE '[Deleted] %'
       LIMIT 1`,
        [groupId]
      );

      if (groups.length === 0) {
        // This shouldn't happen if groupExists check passed, but just in case
        throw new GroupNotFoundError();
      }

      // In your getGroup method, after fetching the group data:
      const group = groups[0];

      // Get storage data if exists
      const [storageData] = await pool.query(
        `SELECT * FROM group_storage_data WHERE group_id = ?`,
        [groupId]
      );

      // Generate URLs if storage data exists
      if (storageData.length > 0) {
        const sd = storageData[0];

        if (group.group_picture && sd.picture_storage_type) {
          group.group_picture_url = storageManager.getPublicUrl(
            sd.picture_storage_type,
            group.group_picture
          );
        }

        if (group.group_cover && sd.cover_storage_type) {
          group.group_cover_url = storageManager.getPublicUrl(
            sd.cover_storage_type,
            group.group_cover
          );
        }
      } else {
        // Fallback: If no storage data, use the path directly
        if (group.group_picture) {
          group.group_picture_url = group.group_picture;
        }
        if (group.group_cover) {
          group.group_cover_url = group.group_cover;
        }
      }
      // Check permissions based on privacy
      const isMember = await GroupController.isUserMember(groupId, userId);
      const isAdmin = await GroupController.isUserAdmin(groupId, userId);
      const isCreator = await GroupController.isUserCreator(groupId, userId);

      // Fix the privacy check logic
      let hasAccess = false;
      switch (group.group_privacy) {
        case "public":
          hasAccess = true;
          break;
        case "closed":
        case "secret":
          hasAccess = isMember || isAdmin || isCreator;
          break;
        default:
          hasAccess = true;
      }

      if (!hasAccess) {
        throw new UnauthorizedError(
          "You don't have permission to view this group"
        );
      }

      // Get pinned post info if exists
      if (group.group_pinned_post) {
        const [pinnedPost] = await pool.query(
          `SELECT p.*, u.user_name, u.user_picture 
           FROM posts p 
           JOIN users u ON u.user_id = p.user_id 
           WHERE p.post_id = ?`,
          [group.group_pinned_post]
        );
        group.pinned_post_info = pinnedPost[0] || null;
      }

      // Get album counts
      const [albumCounts] = await pool.query(
        `SELECT 
          (SELECT COUNT(*) FROM posts_photos_albums ppa 
           WHERE ppa.group_id = ? AND ppa.in_group = '1') as album_count,
          (SELECT COUNT(*) FROM posts_photos pp 
           JOIN posts_photos_albums ppa ON ppa.album_id = pp.album_id 
           WHERE ppa.group_id = ?) as photo_count
         FROM dual`,
        [groupId, groupId]
      );
      group.album_stats = albumCounts[0];

      res.json({
        success: true,
        data: {
          group,
          permissions: {
            is_member: isMember,
            is_admin: isAdmin,
            is_creator: isCreator,
            can_post: isMember || group.group_privacy === "public",
            can_comment: isMember || group.group_privacy === "public",
            can_invite: isMember,
            can_manage: isAdmin,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
  // ADD MEMBER (Admin adding user directly)
  static async addMember(req, res, next) {
    const connection = await pool.getConnection();
    try {
      const { groupId } = req.params;
      const { userId, approved = "1" } = req.body;
      const adminId = GroupController.getCurrentUserId(req);

      // Check if user is admin
      if (!(await GroupController.isUserAdmin(groupId, adminId))) {
        throw new UnauthorizedError("Only admins can add members");
      }

      await connection.beginTransaction();

      // Check if user already exists in group
      const [existing] = await connection.query(
        "SELECT approved FROM groups_members WHERE group_id = ? AND user_id = ?",
        [groupId, userId]
      );

      if (existing.length > 0) {
        // If already a member, update approval status if needed
        if (existing[0].approved !== approved) {
          await connection.query(
            "UPDATE groups_members SET approved = ? WHERE group_id = ? AND user_id = ?",
            [approved, groupId, userId]
          );

          // Update member count if status changed to approved
          if (approved === "1" && existing[0].approved === "0") {
            await connection.query(
              "UPDATE `groups` SET group_members = group_members + 1 WHERE group_id = ?",
              [groupId]
            );
          }
          // Decrement if changed from approved to pending
          else if (approved === "0" && existing[0].approved === "1") {
            await connection.query(
              "UPDATE `groups` SET group_members = group_members - 1 WHERE group_id = ?",
              [groupId]
            );
          }
        }

        await connection.commit();
        return res.json({
          success: true,
          message:
            existing[0].approved === "1"
              ? "User is already an approved member"
              : "User already has a pending request",
        });
      }

      // Add new member
      await connection.query(
        "INSERT INTO groups_members (group_id, user_id, approved, requested_at) VALUES (?, ?, ?, NOW())",
        [groupId, userId, approved]
      );

      // Increment member count if approved immediately
      if (approved === "1") {
        await connection.query(
          "UPDATE `groups` SET group_members = group_members + 1 WHERE group_id = ?",
          [groupId]
        );
      }

      // Notify the user if they were added as approved member
      if (approved === "1") {
        // Get group info for notification
        const [group] = await connection.query(
          "SELECT group_title FROM `groups` WHERE group_id = ?",
          [groupId]
        );

        await connection.query(
          `INSERT INTO notifications 
         (to_user_id, from_user_id, from_user_type, action, node_type, node_url, message, time)
         VALUES (?, ?, 'user', 'added_to_group', 'group', CONCAT('/groups/', ?), ?, NOW())`,
          [
            userId,
            adminId,
            groupId,
            `You were added to "${group[0].group_title}"`,
          ]
        );
      }

      await connection.commit();

      res.json({
        success: true,
        message:
          approved === "1"
            ? "Member added successfully"
            : "Member invitation sent (pending approval)",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // In groupController.js
  static async removeMember(req, res, next) {
    const connection = await pool.getConnection();
    try {
      const { groupId, memberId } = req.params;
      const userId = GroupController.getCurrentUserId(req);

      console.log("\n=== REMOVE MEMBER DEBUG ===");
      console.log("Params received:", { groupId, memberId, userId });
      console.log("MemberId type:", typeof memberId, "Value:", memberId);

      // Check if user is admin
      if (!(await GroupController.isUserAdmin(groupId, userId))) {
        throw new UnauthorizedError("Only admins can remove members");
      }

      await connection.beginTransaction();

      // FIRST: Get the user_id from the membership_id
      const [membership] = await connection.query(
        "SELECT user_id, approved FROM groups_members WHERE id = ? AND group_id = ?",
        [memberId, groupId] // Now memberId is the membership_id (id column)
      );

      console.log("Membership found:", membership);

      if (membership.length === 0) {
        throw new ValidationError("Member not found in this group");
      }

      const targetUserId = membership[0].user_id;
      const isApproved = membership[0].approved === "1";

      console.log("Target user ID:", targetUserId);
      console.log("Is approved member:", isApproved);

      // Prevent removing group creator
      if (await GroupController.isUserCreator(groupId, targetUserId)) {
        throw new ValidationError("Cannot remove the group creator");
      }

      // Prevent removing yourself
      if (parseInt(targetUserId) === parseInt(userId)) {
        throw new ValidationError(
          "Admins cannot remove themselves. Use leave group instead."
        );
      }

      // Remove from members table using membership_id
      await connection.query(
        "DELETE FROM groups_members WHERE id = ? AND group_id = ?",
        [memberId, groupId]
      );

      // Remove from admins if they were admin
      await connection.query(
        "DELETE FROM groups_admins WHERE group_id = ? AND user_id = ?",
        [groupId, targetUserId]
      );

      // Decrement member count if they were approved
      if (isApproved) {
        await connection.query(
          "UPDATE `groups` SET group_members = group_members - 1 WHERE group_id = ?",
          [groupId]
        );
      }

      await connection.commit();

      res.json({
        success: true,
        message: "Member removed successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }
  // LEAVE GROUP - Updated to prevent last admin from leaving
  static async leaveGroup(req, res, next) {
    const connection = await pool.getConnection();
    try {
      const { groupId } = req.params;
      const userId = GroupController.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedError("Authentication required");
      }

      await connection.beginTransaction();

      // Check if user is the group creator
      const [group] = await connection.query(
        "SELECT group_admin FROM `groups` WHERE group_id = ?",
        [groupId]
      );

      if (group.length === 0) {
        throw new ValidationError("Group not found");
      }

      const isCreator = group[0].group_admin == userId;

      // Prevent group creator from leaving
      if (isCreator) {
        throw new ValidationError(
          "Group creator cannot leave the group. You must delete the group or transfer ownership first."
        );
      }

      // Check if user is an admin
      const [admin] = await connection.query(
        "SELECT 1 FROM groups_admins WHERE group_id = ? AND user_id = ?",
        [groupId, userId]
      );

      const isAdmin = admin.length > 0;

      // If user is admin, check if they're the last admin
      if (isAdmin) {
        const [adminCount] = await connection.query(
          "SELECT COUNT(*) as count FROM groups_admins WHERE group_id = ?",
          [groupId]
        );

        if (adminCount[0].count <= 1) {
          throw new ValidationError(
            "You are the last admin. Please appoint another admin before leaving."
          );
        }
      }

      // Check membership
      const [membership] = await connection.query(
        `SELECT approved FROM groups_members WHERE group_id = ? AND user_id = ?`,
        [groupId, userId]
      );

      if (membership.length === 0) {
        throw new ValidationError("You are not a member of this group");
      }

      const wasApproved = membership[0].approved === "1";

      // Remove from members and admins
      await connection.query(
        "DELETE FROM groups_members WHERE group_id = ? AND user_id = ?",
        [groupId, userId]
      );

      await connection.query(
        "DELETE FROM groups_admins WHERE group_id = ? AND user_id = ?",
        [groupId, userId]
      );

      // Decrement member count if they were an approved member
      if (wasApproved) {
        await connection.query(
          "UPDATE `groups` SET group_members = group_members - 1 WHERE group_id = ?",
          [groupId]
        );
      }

      await connection.commit();

      res.json({
        success: true,
        message: "Successfully left the group",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }
  // TRANSFER OWNERSHIP - New method
  static async transferOwnership(req, res, next) {
    const connection = await pool.getConnection();
    try {
      const { groupId } = req.params;
      const { newOwnerId } = req.body;
      const userId = GroupController.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedError("Authentication required");
      }

      await connection.beginTransaction();

      // Check if user is the current group creator
      const [group] = await connection.query(
        "SELECT group_admin FROM `groups` WHERE group_id = ?",
        [groupId]
      );

      if (group.length === 0) {
        throw new GroupNotFoundError();
      }

      if (group[0].group_admin != userId) {
        throw new UnauthorizedError(
          "Only the group creator can transfer ownership"
        );
      }

      // Check if new owner exists and is a member
      const [newOwner] = await connection.query(
        `SELECT 1 FROM groups_members 
       WHERE group_id = ? AND user_id = ? AND approved = '1'`,
        [groupId, newOwnerId]
      );

      if (newOwner.length === 0) {
        throw new ValidationError(
          "New owner must be an approved member of the group"
        );
      }

      // Check if new owner is already admin
      const [isAdmin] = await connection.query(
        "SELECT 1 FROM groups_admins WHERE group_id = ? AND user_id = ?",
        [groupId, newOwnerId]
      );

      // Make new owner an admin if not already
      if (isAdmin.length === 0) {
        await connection.query(
          "INSERT INTO groups_admins (group_id, user_id) VALUES (?, ?)",
          [groupId, newOwnerId]
        );
      }

      // Transfer ownership
      await connection.query(
        "UPDATE `groups` SET group_admin = ? WHERE group_id = ?",
        [newOwnerId, groupId]
      );

      // Notify both users
      await connection.query(
        `INSERT INTO notifications 
       (to_user_id, from_user_id, from_user_type, action, node_type, node_url, message, time)
       VALUES (?, ?, 'user', 'group_ownership_transferred', 'group', CONCAT('/groups/', ?), ?, NOW())`,
        [newOwnerId, userId, groupId, "You are now the owner of the group"]
      );

      await connection.query(
        `INSERT INTO notifications 
       (to_user_id, from_user_id, from_user_type, action, node_type, node_url, message, time)
       VALUES (?, ?, 'user', 'group_ownership_transferred_to', 'group', CONCAT('/groups/', ?), ?, NOW())`,
        [
          userId,
          newOwnerId,
          groupId,
          `You transferred group ownership to another member`,
        ]
      );

      await connection.commit();

      res.json({
        success: true,
        message: "Group ownership transferred successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // REMOVE ADMIN
  static async removeAdmin(req, res, next) {
    const connection = await pool.getConnection();
    try {
      const { groupId, adminId } = req.params;
      const userId = GroupController.getCurrentUserId(req);

      // Only current admins can remove others
      if (!(await GroupController.isUserAdmin(groupId, userId))) {
        throw new UnauthorizedError("Only group admins can remove admins");
      }

      // Prevent removing the group creator
      const isCreator = await GroupController.isUserCreator(groupId, adminId);
      if (isCreator) {
        throw new ValidationError("Cannot remove the group creator");
      }

      await connection.query(
        "DELETE FROM groups_admins WHERE group_id = ? AND user_id = ?",
        [groupId, adminId]
      );

      // Notify the removed admin
      await connection.query(
        `INSERT INTO notifications 
         (to_user_id, from_user_id, from_user_type, action, node_type, node_url, time)
         VALUES (?, ?, 'user', 'removed_group_admin', 'group', CONCAT('/groups/', ?), NOW())`,
        [adminId, userId, groupId]
      );

      res.json({
        success: true,
        message: "Admin removed successfully",
      });
    } catch (error) {
      next(error);
    } finally {
      connection.release();
    }
  }

  // GET GROUP ADMINS
  static async getGroupAdmins(req, res, next) {
    try {
      const { groupId } = req.params;
      const userId = GroupController.getCurrentUserId(req);

      const isMember = await GroupController.isUserMember(groupId, userId);
      const isAdmin = await GroupController.isUserAdmin(groupId, userId);

      const [group] = await pool.query(
        "SELECT group_privacy FROM `groups` WHERE group_id = ?",
        [groupId]
      );

      if (group.length === 0) throw new GroupNotFoundError();

      if (group[0].group_privacy === "secret" && !isMember && !isAdmin) {
        throw new UnauthorizedError("You don't have permission to view admins");
      }

      const [admins] = await pool.query(
        `SELECT 
          u.user_id,
          u.user_name,
          u.user_firstname,
          u.user_lastname,
          u.user_picture,
          u.user_verified,
          (u.user_id = g.group_admin) as is_creator
         FROM groups_admins ga
         JOIN users u ON u.user_id = ga.user_id
         JOIN \`groups\` g ON g.group_id = ga.group_id
         WHERE ga.group_id = ?
         ORDER BY is_creator DESC, u.user_name`,
        [groupId]
      );

      res.json({
        success: true,
        data: { admins },
      });
    } catch (error) {
      next(error);
    }
  }

  // UNPIN POST
  static async unpinPost(req, res, next) {
    try {
      const { groupId } = req.params;
      const userId = GroupController.getCurrentUserId(req);

      if (!(await GroupController.isUserAdmin(groupId, userId))) {
        throw new UnauthorizedError("Only admins can unpin posts");
      }

      await pool.query(
        "UPDATE `groups` SET group_pinned_post = NULL WHERE group_id = ?",
        [groupId]
      );

      res.json({
        success: true,
        message: "Post unpinned successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  // CREATE CATEGORY
  static async createCategory(req, res, next) {
    try {
      const userId = GroupController.getCurrentUserId(req);
      const {
        category_name,
        category_parent_id = 0,
        category_order = 0,
      } = req.body;

      if (!category_name) {
        throw new ValidationError("Category name is required");
      }

      const [result] = await pool.query(
        "INSERT INTO groups_categories (category_name, category_parent_id, category_order) VALUES (?, ?, ?)",
        [category_name, category_parent_id, category_order]
      );

      res.status(201).json({
        success: true,
        message: "Category created",
        data: { category_id: result.insertId },
      });
    } catch (error) {
      next(error);
    }
  }

  // UPDATE CATEGORY
  static async updateCategory(req, res, next) {
    try {
      const { categoryId } = req.params;
      const { category_name, category_parent_id, category_order } = req.body;

      const updates = [];
      const values = [];

      if (category_name !== undefined) {
        updates.push("category_name = ?");
        values.push(category_name);
      }
      if (category_parent_id !== undefined) {
        updates.push("category_parent_id = ?");
        values.push(category_parent_id);
      }
      if (category_order !== undefined) {
        updates.push("category_order = ?");
        values.push(category_order);
      }

      if (updates.length === 0) {
        throw new ValidationError("No fields to update");
      }

      values.push(categoryId);

      await pool.query(
        `UPDATE groups_categories SET ${updates.join(
          ", "
        )} WHERE category_id = ?`,
        values
      );

      res.json({
        success: true,
        message: "Category updated successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  // DELETE CATEGORY
  static async deleteCategory(req, res, next) {
    const connection = await pool.getConnection();
    try {
      const { categoryId } = req.params;

      await connection.beginTransaction();

      const [groupsInCat] = await connection.query(
        "SELECT 1 FROM `groups` WHERE group_category = ? LIMIT 1",
        [categoryId]
      );

      if (groupsInCat.length > 0) {
        throw new ValidationError(
          "Cannot delete category with assigned groups"
        );
      }

      await connection.query(
        "DELETE FROM groups_categories WHERE category_id = ?",
        [categoryId]
      );

      await connection.commit();

      res.json({
        success: true,
        message: "Category deleted successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 3. UPDATE GROUP
  static async updateGroup(req, res, next) {
    const connection = await pool.getConnection();
    try {
      const { groupId } = req.params;
      const userId = GroupController.getCurrentUserId(req);

      // Check permissions
      if (!(await GroupController.isUserAdmin(groupId, userId))) {
        throw new UnauthorizedError("Only group admins can update the group");
      }

      await connection.beginTransaction();

      // Get current group storage data
      const [currentStorage] = await connection.query(
        "SELECT * FROM group_storage_data WHERE group_id = ?",
        [groupId]
      );

      // Handle new picture upload
      let groupPictureData = null;
      let pictureFilename = null;
      if (req.files && req.files.group_picture && req.files.group_picture[0]) {
        const pictureFile = req.files.group_picture[0];

        // Delete old picture if exists
        if (
          currentStorage.length > 0 &&
          currentStorage[0].picture_storage_type &&
          currentStorage[0].picture_storage_data
        ) {
          const [oldGroup] = await connection.query(
            "SELECT group_picture, group_picture_id FROM `groups` WHERE group_id = ?",
            [groupId]
          );

          if (oldGroup[0] && oldGroup[0].group_picture) {
            // Use storageManager to delete old file
            const storageData = JSON.parse(
              currentStorage[0].picture_storage_data
            );
            await storageManager.delete(
              currentStorage[0].picture_storage_type,
              storageData
            );
          }
        }

        // Upload new picture
        pictureFile.originalname = `group-picture-${Date.now()}-${
          pictureFile.originalname
        }`;
        groupPictureData = await storageManager.upload(
          pictureFile,
          "group-pictures"
        );

        // Store picture filename for database
        pictureFilename = groupPictureData.filename;

        // Update group table
        await connection.query(
          "UPDATE `groups` SET group_picture = ?, group_picture_id = ? WHERE group_id = ?",
          [groupPictureData.path, groupPictureData.filename, groupId]
        );

        // Update storage data
        if (currentStorage.length > 0) {
          await connection.query(
            `UPDATE group_storage_data SET 
          picture_storage_type = ?, picture_storage_data = ? 
         WHERE group_id = ?`,
            [
              groupPictureData.storage_type,
              groupPictureData.storage_data,
              groupId,
            ]
          );
        } else {
          await connection.query(
            `INSERT INTO group_storage_data 
         (group_id, picture_storage_type, picture_storage_data) 
         VALUES (?, ?, ?)`,
            [
              groupId,
              groupPictureData.storage_type,
              groupPictureData.storage_data,
            ]
          );
        }

        // Clean up temp file
        if (pictureFile.path && pictureFile.path.startsWith("/tmp/")) {
          try {
            await fs.unlink(pictureFile.path);
          } catch (err) {
            console.log("Failed to delete temp file:", err.message);
          }
        }
      }

      // Handle new cover upload
      let groupCoverData = null;
      let coverFilename = null;
      if (req.files && req.files.group_cover && req.files.group_cover[0]) {
        const coverFile = req.files.group_cover[0];

        // Delete old cover if exists
        if (
          currentStorage.length > 0 &&
          currentStorage[0].cover_storage_type &&
          currentStorage[0].cover_storage_data
        ) {
          const [oldGroup] = await connection.query(
            "SELECT group_cover, group_cover_id FROM `groups` WHERE group_id = ?",
            [groupId]
          );

          if (oldGroup[0] && oldGroup[0].group_cover) {
            // Use storageManager to delete old file
            const storageData = JSON.parse(
              currentStorage[0].cover_storage_data
            );
            await storageManager.delete(
              currentStorage[0].cover_storage_type,
              storageData
            );
          }
        }

        // Upload new cover
        coverFile.originalname = `group-cover-${Date.now()}-${
          coverFile.originalname
        }`;
        groupCoverData = await storageManager.upload(coverFile, "group-covers");

        // Store cover filename for database
        coverFilename = groupCoverData.filename;

        // Update group table
        await connection.query(
          "UPDATE `groups` SET group_cover = ?, group_cover_id = ? WHERE group_id = ?",
          [groupCoverData.path, groupCoverData.filename, groupId]
        );

        // Update storage data
        if (currentStorage.length > 0) {
          await connection.query(
            `UPDATE group_storage_data SET 
          cover_storage_type = ?, cover_storage_data = ? 
         WHERE group_id = ?`,
            [groupCoverData.storage_type, groupCoverData.storage_data, groupId]
          );
        } else {
          await connection.query(
            `INSERT INTO group_storage_data 
         (group_id, cover_storage_type, cover_storage_data) 
         VALUES (?, ?, ?)`,
            [groupId, groupCoverData.storage_type, groupCoverData.storage_data]
          );
        }

        // Clean up temp file
        if (coverFile.path && coverFile.path.startsWith("/tmp/")) {
          try {
            await fs.unlink(coverFile.path);
          } catch (err) {
            console.log("Failed to delete temp file:", err.message);
          }
        }
      }

      // Handle other updates based on your database schema
      const allowedUpdates = {
        group_title: "string",
        group_description: "string",
        group_privacy: "string",
        group_category: "number",
        group_name: "string",
        group_cover_position: "string",
        group_publish_enabled: "string",
        group_publish_approval_enabled: "string",
        chatbox_enabled: "string",
        group_monetization_enabled: "string",
        group_monetization_min_price: "number",
        group_monetization_plans: "number",
      };

      const validPrivacyOptions = ["secret", "closed", "public"]; // From your enum

      // Process other updates
      const updates = [];
      const values = [];

      for (const [field, validation] of Object.entries(allowedUpdates)) {
        if (req.body[field] !== undefined) {
          let value = req.body[field];

          // Validate based on field type
          switch (field) {
            case "group_title":
              if (typeof value !== "string" || value.trim().length === 0) {
                throw new ValidationError("Group title is required");
              }
              if (value.length > 256) {
                throw new ValidationError(
                  "Title must be less than 256 characters"
                );
              }
              value = value.trim();
              break;

            case "group_name":
              if (typeof value !== "string" || value.trim().length === 0) {
                throw new ValidationError("Group name is required");
              }
              value = value.trim();

              if (!/^[a-z0-9_-]{3,64}$/i.test(value)) {
                throw new ValidationError(
                  "Group name must be 3-64 characters, alphanumeric with underscores or hyphens"
                );
              }

              // Check if group name is already taken (excluding current group)
              const [existingGroup] = await connection.query(
                "SELECT group_id FROM `groups` WHERE group_name = ? AND group_id != ?",
                [value, groupId]
              );
              if (existingGroup.length > 0) {
                throw new ValidationError("Group name is already taken", 409);
              }
              break;

            case "group_privacy":
              if (!validPrivacyOptions.includes(value)) {
                throw new ValidationError(
                  `Privacy must be one of: ${validPrivacyOptions.join(", ")}`
                );
              }
              break;

            case "group_category":
              value = parseInt(value);
              if (isNaN(value) || value <= 0) {
                throw new ValidationError("Invalid category");
              }
              // Verify category exists
              const [categoryExists] = await connection.query(
                "SELECT category_id FROM groups_categories WHERE category_id = ?",
                [value]
              );
              if (categoryExists.length === 0) {
                throw new ValidationError("Category does not exist");
              }
              break;

            case "group_description":
              if (typeof value !== "string") {
                value = "";
              }
              value = value.trim();
              // mediumtext can store up to 16MB, but we'll limit to reasonable size
              if (value.length > 10000000) {
                throw new ValidationError("Description is too long");
              }
              break;

            case "group_publish_enabled":
            case "group_publish_approval_enabled":
            case "chatbox_enabled":
            case "group_monetization_enabled":
              if (value !== "0" && value !== "1") {
                throw new ValidationError(`${field} must be either "0" or "1"`);
              }
              break;

            case "group_monetization_min_price":
              value = parseFloat(value);
              if (isNaN(value) || value < 0) {
                throw new ValidationError(`Invalid value for minimum price`);
              }
              break;

            case "group_monetization_plans":
              value = parseInt(value);
              if (isNaN(value) || value < 0) {
                throw new ValidationError(
                  `Invalid value for monetization plans`
                );
              }
              break;

            case "group_cover_position":
              if (typeof value !== "string" || value.length > 256) {
                throw new ValidationError(
                  "Cover position must be a string less than 256 characters"
                );
              }
              value = value.trim();
              break;

            default:
              if (typeof value !== validation) {
                throw new ValidationError(`Invalid type for ${field}`);
              }
          }

          updates.push(`${field} = ?`);
          values.push(value);
        }
      }

      // Update group info if there are changes
      if (updates.length > 0) {
        values.push(groupId);
        const query = `UPDATE \`groups\` SET ${updates.join(
          ", "
        )} WHERE group_id = ?`;
        await connection.query(query, values);
      }

      await connection.commit();

      // Get updated group data with correct column names from your schema
      const [updatedGroup] = await connection.query(
        `SELECT g.*, 
          (SELECT COUNT(*) FROM groups_members gm WHERE gm.group_id = g.group_id) as group_members
   FROM \`groups\` g 
   WHERE g.group_id = ?`,
        [groupId]
      );

      // Get permissions for the user
      const [permissions] = await connection.query(
        `SELECT 
        CASE WHEN g.group_admin = ? THEN 1 ELSE 0 END as is_creator,
        EXISTS(SELECT 1 FROM groups_admins WHERE group_id = ? AND user_id = ?) as is_admin,
        EXISTS(SELECT 1 FROM groups_members WHERE group_id = ? AND user_id = ?) as is_member
       FROM \`groups\` g
       WHERE g.group_id = ?`,
        [userId, groupId, userId, groupId, userId, groupId]
      );

      // Generate public URLs for response
      const groupPictureUrl = groupPictureData
        ? groupPictureData.public_url
        : null;
      const groupCoverUrl = groupCoverData ? groupCoverData.public_url : null;

      res.json({
        success: true,
        message: "Group updated successfully",
        data: {
          group: {
            ...updatedGroup[0],
            group_picture_url: groupPictureUrl,
            group_cover_url: groupCoverUrl,
          },
          permissions: permissions[0] || {
            is_creator: false,
            is_admin: false,
            is_member: false,
          },
        },
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 4. DELETE GROUP
  static async deleteGroup(req, res, next) {
    const connection = await pool.getConnection();
    try {
      const { groupId } = req.params;
      const { hardDelete = false } = req.query;
      const userId = GroupController.getCurrentUserId(req);

      // Check if user is creator
      if (!(await GroupController.isUserCreator(groupId, userId))) {
        throw new UnauthorizedError(
          "Only the group creator can delete the group"
        );
      }

      await connection.beginTransaction();

      if (hardDelete === "true") {
        // Hard delete
        await connection.query(
          "DELETE FROM groups_members WHERE group_id = ?",
          [groupId]
        );
        await connection.query("DELETE FROM groups_admins WHERE group_id = ?", [
          groupId,
        ]);

        await connection.query(
          `UPDATE posts SET in_group = '0', group_id = NULL 
           WHERE group_id = ? AND in_group = '1'`,
          [groupId]
        );

        await connection.query(
          `UPDATE posts_photos_albums SET in_group = '0', group_id = NULL 
           WHERE group_id = ? AND in_group = '1'`,
          [groupId]
        );

        await connection.query("DELETE FROM `groups` WHERE group_id = ?", [
          groupId,
        ]);
      } else {
        // Soft delete
        const timestamp = Date.now();
        await connection.query(
          `UPDATE \`groups\` SET 
            group_name = CONCAT('deleted_', ?, '_', group_name),
            group_title = CONCAT('[Deleted] ', group_title)
           WHERE group_id = ?`,
          [timestamp, groupId]
        );
      }

      await connection.commit();

      res.json({
        success: true,
        message: hardDelete
          ? "Group permanently deleted"
          : "Group marked as deleted",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 5. JOIN GROUP
  // 5. JOIN GROUP - improved version
  static async joinGroup(req, res, next) {
    const connection = await pool.getConnection();
    try {
      const { groupId } = req.params;
      const userId = GroupController.getCurrentUserId(req);

      if (!userId) throw new UnauthorizedError("Authentication required");

      await connection.beginTransaction();

      const [group] = await connection.query(
        `SELECT group_privacy, group_title, group_admin
       FROM \`groups\` 
       WHERE group_id = ?`,
        [groupId]
      );

      if (group.length === 0) throw new GroupNotFoundError();

      const { group_privacy, group_title, group_admin } = group[0];

      // Group admin is automatically a member
      if (parseInt(group_admin) === parseInt(userId)) {
        await connection.commit();
        return res.json({
          success: true,
          message: "You are the group admin",
          data: {
            is_admin: true,
            is_member: true,
            approved: true,
          },
        });
      }

      // Check existing membership
      const [existing] = await connection.query(
        `SELECT approved FROM groups_members 
       WHERE group_id = ? AND user_id = ?`,
        [groupId, userId]
      );

      if (existing.length > 0) {
        const isApproved = existing[0].approved === "1";
        await connection.commit();
        return res.json({
          success: true,
          message: isApproved
            ? "You are already a member of this group"
            : "Your join request is pending approval",
          data: {
            is_member: isApproved,
            approved: isApproved,
            requires_approval: !isApproved,
            is_pending: !isApproved,
          },
        });
      }

      let approved = "0";
      let message = "Join request sent. Waiting for approval.";
      let action = "requested";

      // Auto-approve for public groups
      if (group_privacy === "public") {
        approved = "1";
        message = "Successfully joined the group!";
        action = "joined";
      }
      // closed & secret → always require approval
      else if (["closed", "secret"].includes(group_privacy)) {
        approved = "0";
        message = "Join request sent. Waiting for approval.";
        action = "requested";
      }

      const requiresApproval = approved === "0";

      // Insert membership
      await connection.query(
        `INSERT INTO groups_members (group_id, user_id, approved) 
       VALUES (?, ?, ?)`,
        [groupId, userId, approved]
      );

      // Only increment counter for approved members
      if (approved === "1") {
        await connection.query(
          "UPDATE `groups` SET group_members = group_members + 1 WHERE group_id = ?",
          [groupId]
        );
      }

      // Create notification for admins if requires approval
      if (requiresApproval) {
        const [user] = await connection.query(
          "SELECT user_name, user_firstname, user_lastname FROM users WHERE user_id = ?",
          [userId]
        );

        const userName =
          user[0].user_name || user[0].user_firstname || "A user";
        const notificationMessage = `${userName} requested to join "${group_title}"`;

        await connection.query(
          `INSERT INTO notifications 
         (to_user_id, from_user_id, from_user_type, action, node_type, node_url, message, time)
         SELECT 
           ga.user_id, 
           ?, 
           'user',
           'group_join_request',
           'group',
           CONCAT('/groups/', ?),
           ?,
           NOW()
         FROM groups_admins ga 
         WHERE ga.group_id = ?`,
          [userId, groupId, notificationMessage, groupId]
        );
      }

      await connection.commit();

      res.json({
        success: true,
        message,
        data: {
          approved: approved === "1",
          requires_approval: approved === "0",
          is_member: approved === "1",

          is_pending: approved === "0",
          action: action, // "joined" or "requested"
          membership_status: approved === "1" ? "member" : "pending",
        },
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 6. GET GROUP MEMBERS WITH PAGINATION
  static async getGroupMembers(req, res, next) {
    try {
      const { groupId } = req.params;
      const userId = GroupController.getCurrentUserId(req);
      const {
        page = 1,
        limit = 50,
        approvedOnly = "1", // Default to showing approved members
        search = "",
        role = "all",
        sort = "joined_desc",
      } = req.query;

      const offset = (page - 1) * limit;

      // Check permissions
      const isMember = await GroupController.isUserMember(groupId, userId);
      const isAdmin = await GroupController.isUserAdmin(groupId, userId);

      const [group] = await pool.query(
        "SELECT group_privacy FROM `groups` WHERE group_id = ?",
        [groupId]
      );

      if (group.length === 0) {
        throw new GroupNotFoundError();
      }

      // Privacy check
      if (
        ["secret", "closed"].includes(group[0].group_privacy) &&
        !isMember &&
        !isAdmin
      ) {
        throw new UnauthorizedError(
          "You don't have permission to view members"
        );
      }

      // Build query - FIXED: Handle approvedOnly correctly
      let whereClauses = ["gm.group_id = ?"];
      const values = [groupId];

      // CRITICAL FIX: Handle approvedOnly parameter properly
      if (approvedOnly === "1") {
        whereClauses.push('gm.approved = "1"');
      } else if (approvedOnly === "0") {
        whereClauses.push('gm.approved = "0"');
      }
      // If approvedOnly is not specified or invalid, show both approved and pending

      if (search) {
        whereClauses.push(
          "(u.user_name LIKE ? OR u.user_firstname LIKE ? OR u.user_lastname LIKE ?)"
        );
        const searchTerm = `%${search}%`;
        values.push(searchTerm, searchTerm, searchTerm);
      }

      if (role === "admin") {
        whereClauses.push("ga.user_id IS NOT NULL");
      } else if (role === "member") {
        whereClauses.push("ga.user_id IS NULL");
      }

      // Sort options
      const sortMap = {
        name_asc: "u.user_firstname ASC, u.user_lastname ASC",
        name_desc: "u.user_firstname DESC, u.user_lastname DESC",
        recent: "gm.id DESC",
      };

      const orderBy = sortMap[sort] || "u.user_firstname ASC";

      // Get total count for pagination
      const [countResult] = await pool.query(
        `SELECT COUNT(*) as total 
       FROM groups_members gm
       JOIN users u ON u.user_id = gm.user_id
       LEFT JOIN groups_admins ga ON ga.group_id = gm.group_id AND ga.user_id = gm.user_id
       WHERE ${whereClauses.join(" AND ")}`,
        values
      );

      const total = countResult[0].total;
      const totalPages = Math.ceil(total / limit);

      // Get members
      const [members] = await pool.query(
        `SELECT DISTINCT
        u.user_id,
        u.user_name,
        u.user_firstname,
        u.user_lastname,
        u.user_picture,
        u.user_verified,
        u.user_last_seen,
        gm.approved,
        gm.id as membership_id,
        (SELECT 1 FROM groups_admins ga 
         WHERE ga.group_id = gm.group_id AND ga.user_id = gm.user_id) as is_admin,
        (SELECT COUNT(*) FROM posts p 
         WHERE p.user_id = gm.user_id AND p.group_id = gm.group_id) as posts_count
       FROM groups_members gm
       JOIN users u ON u.user_id = gm.user_id
       LEFT JOIN groups_admins ga ON ga.group_id = gm.group_id AND ga.user_id = gm.user_id
       WHERE ${whereClauses.join(" AND ")}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
        [...values, parseInt(limit), offset]
      );

      res.json({
        success: true,
        data: {
          members,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            total_pages: totalPages,
            has_next: page < totalPages,
            has_prev: page > 1,
          },
          // Add debug info
          debug: {
            approvedOnly_param: approvedOnly,
            filter_applied:
              approvedOnly === "1"
                ? "approved = '1'"
                : approvedOnly === "0"
                ? "approved = '0'"
                : "no filter",
            members_returned: members.length,
            all_approved_status: members.map((m) => ({
              id: m.user_id,
              name: m.user_firstname,
              approved: m.approved,
            })),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 7. CREATE POST IN GROUP
  static async createPost(req, res, next) {
    const connection = await pool.getConnection();
    try {
      const { groupId } = req.params;
      const userId = GroupController.getCurrentUserId(req);
      const {
        text,
        photos = [],
        videos = [],
        files = [],
        link,
        feeling_action,
        feeling_value,
        location,
        privacy = "public",
        is_anonymous = "0",
        for_adult = "0",
      } = req.body;
      const post_type = GroupController.determinePostType(req);

      await connection.beginTransaction();

      // Check permissions
      const isMember = await GroupController.isUserMember(groupId, userId);
      const isAdmin = await GroupController.isUserAdmin(groupId, userId);

      const [group] = await connection.query(
        `SELECT group_privacy, group_publish_enabled, group_publish_approval_enabled 
       FROM \`groups\` WHERE group_id = ?`,
        [groupId]
      );

      if (group.length === 0) {
        throw new GroupNotFoundError();
      }

      const {
        group_privacy,
        group_publish_enabled,
        group_publish_approval_enabled,
      } = group[0];

      // Check if user can post
      if (group_publish_enabled === "0" && !isAdmin) {
        throw new UnauthorizedError("Posting is disabled in this group");
      }

      if (group_privacy === "secret" && !isMember) {
        throw new UnauthorizedError("Only members can post in secret groups");
      }

      // Check approval requirement
      const requiresApproval =
        group_publish_approval_enabled === "1" && !isAdmin;
      const isApproved = !requiresApproval;

      // Create post
      const [postResult] = await connection.query(
        `INSERT INTO posts (
        user_id, user_type, in_group, group_id, group_approved,
        post_type, text, privacy, feeling_action, feeling_value,
        location, is_anonymous, for_adult, time, has_approved
      ) VALUES (?, 'user', '1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [
          userId,
          groupId,
          isApproved ? "1" : "0",
          post_type,
          text || null,
          privacy,
          feeling_action || null,
          feeling_value || null,
          location || null,
          is_anonymous,
          for_adult,
          isApproved ? "1" : "0",
        ]
      );

      const postId = postResult.insertId;

      // Handle photos - FIXED: Upload to storage manager
      if (req.files && req.files.photos) {
        for (const photoFile of req.files.photos) {
          photoFile.originalname = `post-photo-${Date.now()}-${
            photoFile.originalname
          }`;

          const photoData = await storageManager.upload(
            photoFile,
            "post-photos"
          );

          await connection.query(
            `INSERT INTO posts_photos (post_id, source, storage_type, storage_data) 
           VALUES (?, ?, ?, ?)`,
            [
              postId,
              photoData.path,
              photoData.storage_type,
              photoData.storage_data,
            ]
          );

          // Clean up temp file
          if (photoFile.path && photoFile.path.startsWith("/tmp/")) {
            try {
              await fs.unlink(photoFile.path);
            } catch (err) {
              console.log("Failed to delete temp file:", err.message);
            }
          }
        }
      } else if (photos && photos.length > 0) {
        // Fallback: Handle base64 or URLs from frontend
        for (const photo of photos) {
          await connection.query(
            `INSERT INTO posts_photos (post_id, source) 
           VALUES (?, ?)`,
            [postId, photo.source]
          );
        }
      }

      // Handle videos
      // Handle videos
      if (req.files && req.files.videos) {
        for (const videoFile of req.files.videos) {
          videoFile.originalname = `post-video-${Date.now()}-${
            videoFile.originalname
          }`;

          // Upload video
          const videoData = await storageManager.upload(
            videoFile,
            "post-videos"
          );

          // Generate thumbnail
          let thumbnailData = null;
          try {
            if (storageManager.isVideoFile(videoFile.mimetype)) {
              thumbnailData = await storageManager.generateThumbnail(videoFile);
            }
          } catch (thumbError) {
            console.log(
              "Thumbnail generation failed, using null:",
              thumbError.message
            );
            thumbnailData = null;
          }

          await connection.query(
            `INSERT INTO posts_videos (post_id, source, thumbnail, storage_type, storage_data, category_id) 
       VALUES (?, ?, ?, ?, ?, ?)`,
            [
              postId,
              videoData.path,
              thumbnailData ? thumbnailData.path : null,
              videoData.storage_type,
              videoData.storage_data,
              null,
            ]
          );

          // Clean up temp file
          if (videoFile.path && videoFile.path.startsWith("/tmp/")) {
            try {
              await fs.unlink(videoFile.path);
            } catch (err) {
              console.log("Failed to delete temp file:", err.message);
            }
          }
        }
      } else if (videos && videos.length > 0) {
        // Fallback
        for (const video of videos) {
          await connection.query(
            `INSERT INTO posts_videos (post_id, source, thumbnail, category_id) 
           VALUES (?, ?, ?, ?)`,
            [
              postId,
              video.source,
              video.thumbnail || null,
              video.category_id || null,
            ]
          );
        }
      }

      // Handle files - FIXED: Upload to storage manager
      if (req.files && req.files.files) {
        for (const file of req.files.files) {
          file.originalname = `post-file-${Date.now()}-${file.originalname}`;

          const fileData = await storageManager.upload(file, "post-files");

          await connection.query(
            `INSERT INTO posts_files (post_id, source, storage_type, storage_data) 
           VALUES (?, ?, ?, ?)`,
            [
              postId,
              fileData.path,
              fileData.storage_type,
              fileData.storage_data,
            ]
          );

          // Clean up temp file
          if (file.path && file.path.startsWith("/tmp/")) {
            try {
              await fs.unlink(file.path);
            } catch (err) {
              console.log("Failed to delete temp file:", err.message);
            }
          }
        }
      } else if (files && files.length > 0) {
        // Fallback
        for (const file of files) {
          await connection.query(
            "INSERT INTO posts_files (post_id, source) VALUES (?, ?)",
            [postId, file.source]
          );
        }
      }

      // Handle link
      // Handle link
      if (link) {
        let linkData;
        try {
          linkData = typeof link === "string" ? JSON.parse(link) : link;
        } catch (e) {
          linkData = { url: link, title: null };
        }

        try {
          const hostname = new URL(linkData.url).hostname;
          await connection.query(
            `INSERT INTO posts_links (post_id, source_url, source_host, source_title) 
       VALUES (?, ?, ?, ?)`,
            [postId, linkData.url, hostname, linkData.title || null]
          );
        } catch (urlError) {
          console.error("Invalid URL:", linkData.url, urlError.message);
          // Insert without hostname if URL is invalid
          await connection.query(
            `INSERT INTO posts_links (post_id, source_url, source_host, source_title) 
       VALUES (?, ?, ?, ?)`,
            [postId, linkData.url, null, linkData.title || null]
          );
        }
      }

      // Send notifications if approved
      if (isApproved) {
        await connection.query(
          `INSERT INTO notifications (to_user_id, from_user_id, from_user_type, action, node_type, node_url, time)
         SELECT 
           gm.user_id,
           ?,
           'user',
           'new_group_post',
           'post',
           CONCAT('/groups/', ?, '/posts/', ?),
           NOW()
         FROM groups_members gm
         WHERE gm.group_id = ? AND gm.approved = '1' AND gm.user_id != ?
         LIMIT 50`,
          [userId, groupId, postId, groupId, userId]
        );
      } else {
        // Notify admins about post needing approval
        await connection.query(
          `INSERT INTO notifications (to_user_id, from_user_id, from_user_type, action, node_type, node_url, time)
         SELECT 
           ga.user_id,
           ?,
           'user',
           'group_post_approval',
           'post',
           CONCAT('/groups/', ?, '/posts/pending'),
           NOW()
         FROM groups_admins ga
         WHERE ga.group_id = ?`,
          [userId, groupId, groupId]
        );
      }

      await connection.commit();

      res.status(201).json({
        success: true,
        message: isApproved
          ? "Post created successfully"
          : "Post submitted for approval",
        data: {
          post_id: postId,
          requires_approval: requiresApproval,
          is_approved: isApproved,
        },
      });
    } catch (error) {
      await connection.rollback();
      console.error("Error in createPost:", error);
      next(error);
    } finally {
      connection.release();
    }
  }

  // 8. GET GROUP POSTS
  // 8. GET GROUP POSTS - Fixed version
  static async getGroupPosts(req, res, next) {
    const connection = await pool.getConnection();
    try {
      const { groupId } = req.params;
      const userId = GroupController.getCurrentUserId(req);
      const {
        page = 1,
        limit = 20,
        type = "all",
        status = "approved",
        sort = "newest",
        search = "",
        user_id = null,
        with_media = false,
      } = req.query;

      const offset = (page - 1) * limit;

      // Check permissions
      const isMember = await GroupController.isUserMember(groupId, userId);
      const isAdmin = await GroupController.isUserAdmin(groupId, userId);

      const [group] = await pool.query(
        "SELECT group_privacy FROM `groups` WHERE group_id = ?",
        [groupId]
      );

      if (group.length === 0) {
        throw new GroupNotFoundError();
      }

      // Privacy check
      if (group[0].group_privacy === "secret" && !isMember && !isAdmin) {
        throw new UnauthorizedError("You don't have permission to view posts");
      }

      // Build query - FIXED: Proper parameter handling
      const whereClauses = ["p.in_group = '1'", "p.group_id = ?"];
      const values = [groupId]; // Initialize values array here

      // Status filter
      if (isAdmin) {
        if (status === "approved") {
          whereClauses.push("p.group_approved = '1'");
        } else if (status === "pending") {
          whereClauses.push("p.group_approved = '0'");
        }
      } else {
        // Non-admins always see approved posts only
        whereClauses.push("p.group_approved = '1'");
      }

      // Type filter
      if (type !== "all" && type !== "undefined") {
        whereClauses.push("p.post_type = ?");
        values.push(type);
      }

      // User filter (for "my posts")
      if (user_id && parseInt(user_id) > 0) {
        whereClauses.push("p.user_id = ?");
        values.push(parseInt(user_id));
      }

      // Search filter
      if (search && search.trim()) {
        whereClauses.push("(p.text LIKE ?)");
        values.push(`%${search.trim()}%`);
      }

      // Media filter
      if (with_media === "true" || with_media === true) {
        whereClauses.push(
          "(p.post_type IN ('photo', 'video') OR EXISTS (SELECT 1 FROM posts_photos WHERE post_id = p.post_id) OR EXISTS (SELECT 1 FROM posts_videos WHERE post_id = p.post_id))"
        );
      }

      // Sort options
      const sortMap = {
        newest: "p.time DESC",
        oldest: "p.time ASC",
        most_liked: "p.reaction_like_count DESC, p.time DESC",
        most_commented: "p.comments DESC, p.time DESC",
        most_viewed: "p.views DESC, p.time DESC",
        popular:
          "(p.reaction_like_count + p.reaction_love_count + p.reaction_haha_count + p.reaction_wow_count + p.reaction_sad_count + p.reaction_angry_count + p.comments) DESC, p.time DESC",
      };

      const orderBy = sortMap[sort] || "p.time DESC";

      console.log("Query Details:", {
        whereClauses,
        values,
        orderBy,
      });

      // Get total count
      const countQuery = `
    SELECT COUNT(*) as total 
    FROM posts p
    WHERE ${whereClauses.join(" AND ")}
  `;

      const [countResult] = await pool.query(countQuery, values);
      const total = countResult[0].total;
      const totalPages = Math.ceil(total / limit);

      console.log("Total posts:", total);

      // DEBUG: Run a simple query to see what posts exist
      const [debugPosts] = await connection.query(
        `SELECT p.post_id, p.user_id, p.text, p.post_type, p.group_approved, p.time,
            u.user_id as uid, u.user_name 
       FROM posts p
       LEFT JOIN users u ON u.user_id = p.user_id
       WHERE p.group_id = ? AND p.in_group = '1' AND p.group_approved = '1'
       ORDER BY p.time DESC`,
        [groupId]
      );

      console.log("DEBUG - Simple query results:", debugPosts.length);
      debugPosts.forEach((post, i) => {
        console.log(`Post ${i + 1}:`, {
          post_id: post.post_id,
          user_id: post.user_id,
          text: post.text ? post.text.substring(0, 50) + "..." : "No text",
          post_type: post.post_type,
          group_approved: post.group_approved,
          user_name: post.user_name,
          uid: post.uid,
        });
      });

      // Get posts with proper user info - FIXED: Handle user joins correctly
      // Use the userId directly in the SELECT subqueries, not in the WHERE values
      const postsQuery = `
    SELECT 
      p.*,
      u.user_id as u_user_id,
      u.user_name,
      u.user_firstname,
      u.user_lastname,
      u.user_picture,
      u.user_verified,
      COALESCE(
        (SELECT COUNT(*) FROM posts_photos pp WHERE pp.post_id = p.post_id),
        0
      ) as photo_count,
      COALESCE(
        (SELECT COUNT(*) FROM posts_videos pv WHERE pv.post_id = p.post_id),
        0
      ) as video_count,
      COALESCE(
        (SELECT COUNT(*) FROM posts_files pf WHERE pf.post_id = p.post_id),
        0
      ) as file_count,
      (SELECT source_thumbnail FROM posts_links pl WHERE pl.post_id = p.post_id LIMIT 1) as link_thumbnail,
      (SELECT source_title FROM posts_links pl WHERE pl.post_id = p.post_id LIMIT 1) as link_title,
      (SELECT source_url FROM posts_links pl WHERE pl.post_id = p.post_id LIMIT 1) as link_url,
      COALESCE(
        (SELECT 1 FROM posts_reactions pr 
         WHERE pr.post_id = p.post_id AND pr.user_id = ${userId || 0}),
        0
      ) as user_reacted,
      COALESCE(
        (SELECT reaction FROM posts_reactions pr 
         WHERE pr.post_id = p.post_id AND pr.user_id = ${userId || 0} LIMIT 1),
        ''
      ) as user_reaction,
      COALESCE(
        (SELECT 1 FROM posts_saved ps 
         WHERE ps.post_id = p.post_id AND ps.user_id = ${userId || 0}),
        0
      ) as is_saved
    FROM posts p
    LEFT JOIN users u ON u.user_id = p.user_id
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

      // Prepare values for the query - ONLY WHERE clause values, limit and offset
      const postsValues = [
        ...values, // WHERE clause values (groupId, type, search, etc.)
        parseInt(limit),
        offset,
      ];

      console.log("Posts Query Values:", postsValues);
      console.log("Posts Query:", postsQuery);

      const [posts] = await connection.query(postsQuery, postsValues);

      console.log("Posts retrieved:", posts.length);

      if (posts.length > 0) {
        console.log("Sample post:", {
          post_id: posts[0].post_id,
          text: posts[0].text?.substring(0, 50),
          user_id: posts[0].user_id,
          u_user_id: posts[0].u_user_id,
          user_name: posts[0].user_name,
          photo_count: posts[0].photo_count,
          video_count: posts[0].video_count,
        });
      }

      // Get media for each post
      for (const post of posts) {
        if (post.photo_count > 0) {
          const [photos] = await connection.query(
            "SELECT photo_id, source, storage_type, storage_data, filename FROM posts_photos WHERE post_id = ? LIMIT 5",
            [post.post_id]
          );

          // Generate URLs for photos if storage data exists
          post.photos = photos.map((photo) => {
            let photoUrl = photo.source;

            // If we have storage data, generate proper URL
            if (photo.storage_type && photo.storage_data) {
              try {
                photoUrl = storageManager.getPublicUrl(
                  photo.storage_type,
                  photo.source,
                  photo.storage_data
                );
              } catch (error) {
                console.error("Error generating photo URL:", error);
              }
            }

            return {
              ...photo,
              url: photoUrl,
            };
          });
        }

        if (post.video_count > 0) {
          const [videos] = await connection.query(
            "SELECT video_id, source, thumbnail, storage_type, storage_data FROM posts_videos WHERE post_id = ?",
            [post.post_id]
          );

          // Generate URLs for videos
          post.videos = videos.map((video) => {
            let videoUrl = video.source;
            let thumbnailUrl = video.thumbnail;

            if (video.storage_type && video.storage_data) {
              try {
                videoUrl = storageManager.getPublicUrl(
                  video.storage_type,
                  video.source,
                  video.storage_data
                );

                if (video.thumbnail) {
                  thumbnailUrl = storageManager.getPublicUrl(
                    video.storage_type,
                    video.thumbnail,
                    video.storage_data
                  );
                }
              } catch (error) {
                console.error("Error generating video URL:", error);
              }
            }

            return {
              ...video,
              url: videoUrl,
              thumbnail_url: thumbnailUrl,
            };
          });
        }

        if (post.file_count > 0) {
          const [files] = await connection.query(
            "SELECT file_id, source, storage_type, storage_data FROM posts_files WHERE post_id = ?",
            [post.post_id]
          );

          post.files = files.map((file) => {
            let fileUrl = file.source;

            if (file.storage_type && file.storage_data) {
              try {
                fileUrl = storageManager.getPublicUrl(
                  file.storage_type,
                  file.source,
                  file.storage_data
                );
              } catch (error) {
                console.error("Error generating file URL:", error);
              }
            }

            return {
              ...file,
              url: fileUrl,
            };
          });
        }
      }

      // Fix: Ensure user info is properly mapped
      const processedPosts = posts.map((post) => ({
        ...post,
        user_id: post.u_user_id || post.user_id, // Use the joined user_id
        user_name: post.user_name || "Unknown User",
        user_firstname: post.user_firstname || "",
        user_lastname: post.user_lastname || "",
        user_picture: post.user_picture || null,
        user_verified: post.user_verified || 0,
      }));

      res.json({
        success: true,
        data: {
          posts: processedPosts,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            total_pages: totalPages,
            has_next: page < totalPages,
            has_prev: page > 1,
          },
        },
      });
    } catch (error) {
      console.error("Error in getGroupPosts:", error);
      next(error);
    } finally {
      connection.release();
    }
  }

  // 9. APPROVE/REJECT POST
  static async approvePost(req, res, next) {
    const connection = await pool.getConnection();
    try {
      const { groupId, postId } = req.params;
      const { action } = req.body;
      const userId = GroupController.getCurrentUserId(req);

      if (!(await GroupController.isUserAdmin(groupId, userId))) {
        throw new UnauthorizedError("Only admins can approve posts");
      }

      if (!["approve", "reject"].includes(action)) {
        throw new ValidationError("Action must be 'approve' or 'reject'");
      }

      await connection.beginTransaction();

      // Get post info
      const [post] = await connection.query(
        "SELECT user_id, group_approved FROM posts WHERE post_id = ? AND group_id = ?",
        [postId, groupId]
      );

      if (post.length === 0) {
        throw new GroupNotFoundError("Post not found in this group");
      }

      if (action === "approve") {
        await connection.query(
          "UPDATE posts SET group_approved = '1', has_approved = '1' WHERE post_id = ?",
          [postId]
        );

        // Notify the post creator
        await connection.query(
          `INSERT INTO notifications 
           (to_user_id, from_user_id, from_user_type, action, node_type, node_url, time)
           VALUES (?, ?, 'user', 'post_approved', 'post', CONCAT('/groups/', ?, '/posts/', ?), NOW())`,
          [post[0].user_id, userId, groupId, postId]
        );
      } else {
        await connection.query(
          "UPDATE posts SET group_approved = '0', has_approved = '1' WHERE post_id = ?",
          [postId]
        );

        // Notify the post creator
        await connection.query(
          `INSERT INTO notifications 
           (to_user_id, from_user_id, from_user_type, action, node_type, node_url, message, time)
           VALUES (?, ?, 'user', 'post_rejected', 'post', CONCAT('/groups/', ?), 'Your post was not approved', NOW())`,
          [post[0].user_id, userId, groupId]
        );
      }

      await connection.commit();

      res.json({
        success: true,
        message: action === "approve" ? "Post approved" : "Post rejected",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }
  static async deletePost(req, res, next) {
    try {
      const { groupId, postId } = req.params;
      const userId = req.user.id;

      // Check if user is admin or post owner
      const [post] = await pool.query(
        "SELECT user_id FROM posts WHERE post_id = ? AND group_id = ?",
        [postId, groupId]
      );

      if (post.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Post not found" });
      }

      const isOwner = post[0].user_id === userId;
      const isAdmin = await GroupController.isUserAdmin(groupId, userId);

      if (!isOwner && !isAdmin) {
        return res.status(403).json({
          success: false,
          error: "You can only delete your own posts",
        });
      }

      // Delete post
      await pool.query("DELETE FROM posts WHERE post_id = ?", [postId]);

      res.json({ success: true, message: "Post deleted successfully" });
    } catch (error) {
      next(error);
    }
  }

  // 10. SEARCH GROUPS
  // 10. SEARCH GROUPS - Updated to filter deleted groups
  // In GroupController.js - update the searchGroups method
    static async searchGroups(req, res, next) {
      try {
        const {
          query = "",
          category_id,
          privacy,
          min_members,
          max_members,
          sort = "relevance",
          page = 1,
          limit = 20,
        } = req.query;

        const userId = GroupController.getCurrentUserId(req);
        const offset = (page - 1) * limit;

        // Build search conditions
        const whereClauses = ["NOT g.group_title LIKE '[Deleted] %'"];
        const values = [];

        // Text search
        if (query) {
          whereClauses.push(
            "(g.group_name LIKE ? OR g.group_title LIKE ? OR g.group_description LIKE ?)"
          );
          const searchTerm = `%${query}%`;
          values.push(searchTerm, searchTerm, searchTerm);
        }

        // Category filter
        if (category_id) {
          whereClauses.push("g.group_category = ?");
          values.push(category_id);
        }

        // Privacy filter
        if (privacy) {
          whereClauses.push("g.group_privacy = ?");
          values.push(privacy);
        } else if (!userId) {
          // If not logged in, only show public groups
          whereClauses.push('g.group_privacy = "public"');
        }

        // Member check for secret groups
        if (userId) {
          whereClauses.push(
            `(g.group_privacy != 'secret' OR EXISTS (
          SELECT 1 FROM groups_members gm 
          WHERE gm.group_id = g.group_id 
          AND gm.user_id = ? 
          AND gm.approved = '1'
        ))`
          );
          values.push(userId);
        }

        // Member count filters
        if (min_members) {
          whereClauses.push("g.group_members >= ?");
          values.push(min_members);
        }
        if (max_members) {
          whereClauses.push("g.group_members <= ?");
          values.push(max_members);
        }

        const whereClause =
          whereClauses.length > 0 ? "WHERE " + whereClauses.join(" AND ") : "";

        // Sort options
        let orderBy;
        let orderByValues = [];

        switch (sort) {
          case "members":
            orderBy = "g.group_members DESC";
            break;
          case "newest":
            orderBy = "g.group_date DESC";
            break;
          case "oldest":
            orderBy = "g.group_date ASC";
            break;
          case "rating":
            orderBy = "g.group_rate DESC";
            break;
          default:
            if (query) {
              const searchTerm = `%${query}%`;
              orderBy =
                "CASE WHEN g.group_name LIKE ? THEN 100 WHEN g.group_title LIKE ? THEN 80 ELSE 10 END DESC, g.group_members DESC";
              orderByValues = [searchTerm, searchTerm];
            } else {
              orderBy = "g.group_members DESC";
            }
            break;
        }

        // Get total count - Use only the filter values
        const [countResult] = await pool.query(
          `SELECT COUNT(*) as total
        FROM \`groups\` g
        ${whereClause}`,
          values
        );

        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        // Build main query parameters
        const queryParams = [
          ...values,
          ...orderByValues,
          userId || 0, // For is_member check
          userId || 0, // For is_pending check
          userId || 0, // For is_admin check
          userId || 0, // For approved field
          parseInt(limit),
          offset,
        ];

        // Get groups
        const [groups] = await pool.query(
          `SELECT 
          g.group_id,
          g.group_name,
          g.group_title,
          g.group_description,
          g.group_privacy,
          g.group_picture,
          g.group_cover,
          g.group_date,
          g.group_members,
          g.group_rate,
          g.group_category,
          gc.category_name,
          -- Check if user is an approved member
          CASE 
            WHEN EXISTS (
              SELECT 1 FROM groups_members gm 
              WHERE gm.group_id = g.group_id 
              AND gm.user_id = ? 
              AND gm.approved = '1'
            ) THEN '1'
            ELSE '0'
          END as is_member,
          -- Check if user has a pending request
          CASE 
            WHEN EXISTS (
              SELECT 1 FROM groups_members gm 
              WHERE gm.group_id = g.group_id 
              AND gm.user_id = ? 
              AND gm.approved = '0'
            ) THEN '1'
            ELSE '0'
          END as is_pending,
          -- Check if user is admin
          CASE 
            WHEN EXISTS (
              SELECT 1 FROM groups_admins ga 
              WHERE ga.group_id = g.group_id 
              AND ga.user_id = ?
            ) THEN '1'
            ELSE '0'
          END as is_admin,
          -- Get the actual approval status
          COALESCE(
            (SELECT approved FROM groups_members gm 
            WHERE gm.group_id = g.group_id AND gm.user_id = ?),
            '0'
          ) as approved
        FROM \`groups\` g
        LEFT JOIN groups_categories gc ON gc.category_id = g.group_category
        ${whereClause}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?`,
          queryParams
        );

        // Generate URLs for groups with storage data
        for (const group of groups) {
          if (group.group_picture || group.group_cover) {
            const [storageData] = await pool.query(
              `SELECT * FROM group_storage_data WHERE group_id = ?`,
              [group.group_id]
            );

            if (storageData.length > 0) {
              const sd = storageData[0];

              if (group.group_picture && sd.picture_storage_type) {
                group.group_picture_url = storageManager.getPublicUrl(
                  sd.picture_storage_type,
                  group.group_picture
                );
              }

              if (group.group_cover && sd.cover_storage_type) {
                group.group_cover_url = storageManager.getPublicUrl(
                  sd.cover_storage_type,
                  group.group_cover
                );
              }
            }
          }
        }

        res.json({
          success: true,
          data: {
            groups,
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              total,
              total_pages: totalPages,
              has_next: page < totalPages,
              has_prev: page > 1,
            },
          },
        });
      } catch (error) {
        console.error("Error in searchGroups:", error);
        next(error);
      }
    }

  // 11. GET GROUP ANALYTICS
  static async getAnalytics(req, res, next) {
    try {
      const { groupId } = req.params;
      const userId = GroupController.getCurrentUserId(req);

      // Check if user is admin
      if (!(await GroupController.isUserAdmin(groupId, userId))) {
        throw new UnauthorizedError("Only group admins can view analytics");
      }

      // Get basic stats
      const [stats] = await pool.query(
        `SELECT 
          g.group_members as total_members,
          (SELECT COUNT(*) FROM groups_members gm 
           WHERE gm.group_id = ? AND gm.approved = '0') as pending_requests,
          
          (SELECT COUNT(*) FROM posts p 
           WHERE p.group_id = ? AND p.in_group = '1') as total_posts,
          (SELECT COUNT(*) FROM posts p 
           WHERE p.group_id = ? AND p.in_group = '1' AND DATE(p.time) = CURDATE()) as today_posts,
          (SELECT COUNT(*) FROM posts p 
           WHERE p.group_id = ? AND p.in_group = '1' AND p.group_approved = '0') as pending_posts,
          
          (SELECT SUM(p.reaction_like_count + p.reaction_love_count + 
                      p.reaction_haha_count + p.reaction_wow_count + 
                      p.reaction_sad_count + p.reaction_angry_count) 
           FROM posts p WHERE p.group_id = ? AND p.in_group = '1') as total_reactions,
          (SELECT SUM(p.comments) 
           FROM posts p WHERE p.group_id = ? AND p.in_group = '1') as total_comments,
          (SELECT SUM(p.shares) 
           FROM posts p WHERE p.group_id = ? AND p.in_group = '1') as total_shares,
          
          (SELECT COUNT(*) FROM groups_members gm 
           WHERE gm.group_id = ? AND gm.approved = '1' 
           AND DATE(gm.id) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)) as weekly_new_members
         FROM \`groups\` g
         WHERE g.group_id = ?`,
        [
          groupId,
          groupId,
          groupId,
          groupId,
          groupId,
          groupId,
          groupId,
          groupId,
          groupId,
        ]
      );

      // Get top posters
      const [topPosters] = await pool.query(
        `SELECT 
          p.user_id,
          u.user_name,
          u.user_picture,
          COUNT(*) as post_count,
          SUM(p.reaction_like_count + p.reaction_love_count + 
              p.reaction_haha_count + p.reaction_wow_count + 
              p.reaction_sad_count + p.reaction_angry_count) as total_reactions
         FROM posts p
         JOIN users u ON u.user_id = p.user_id
         WHERE p.group_id = ? AND p.in_group = '1'
         GROUP BY p.user_id
         ORDER BY post_count DESC
         LIMIT 10`,
        [groupId]
      );

      // Get daily activity for last 7 days
      const [dailyActivity] = await pool.query(
        `SELECT 
          DATE(p.time) as date,
          COUNT(*) as posts,
          SUM(p.reaction_like_count + p.reaction_love_count + 
              p.reaction_haha_count + p.reaction_wow_count + 
              p.reaction_sad_count + p.reaction_angry_count) as reactions,
          SUM(p.comments) as comments
         FROM posts p
         WHERE p.group_id = ? AND p.in_group = '1' 
         AND p.time >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
         GROUP BY DATE(p.time)
         ORDER BY date DESC`,
        [groupId]
      );

      res.json({
        success: true,
        data: {
          summary: stats[0],
          top_posters: topPosters,
          daily_activity: dailyActivity,
          recommendations: GroupController.generateAnalyticsRecommendations(
            stats[0]
          ),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // Helper: Generate recommendations from analytics
  static generateAnalyticsRecommendations(stats) {
    const recommendations = [];

    if (stats.pending_requests > 10) {
      recommendations.push({
        type: "action",
        priority: "high",
        message: `You have ${stats.pending_requests} pending join requests`,
        action: "Review join requests",
        url: "/groups/members?pending=true",
      });
    }

    if (stats.pending_posts > 5) {
      recommendations.push({
        type: "action",
        priority: "medium",
        message: `You have ${stats.pending_posts} posts awaiting approval`,
        action: "Review pending posts",
        url: "/groups/posts?status=pending",
      });
    }

    if (stats.today_posts === 0) {
      recommendations.push({
        type: "suggestion",
        priority: "low",
        message: "No posts today",
        suggestion: "Consider posting content to keep the group active",
      });
    }

    if (stats.total_reactions / (stats.total_posts || 1) < 2) {
      recommendations.push({
        type: "insight",
        priority: "medium",
        message: "Low engagement per post",
        suggestion:
          "Try posting more engaging content or running group activities",
      });
    }

    return recommendations;
  }

  // 12. GET USER GROUPS
  // 12. GET USER GROUPS - Updated to filter deleted groups
  static async getUserGroups(req, res, next) {
    try {
      const { userId: targetUserId } = req.params;
      const userId = GroupController.getCurrentUserId(req);

      const effectiveUserId = targetUserId || userId;
      if (!effectiveUserId) {
        throw new UnauthorizedError("Authentication required");
      }

      const isViewingSelf = effectiveUserId === userId;
      const canViewAll =
        isViewingSelf ||
        (await GroupController.areFriends(userId, effectiveUserId));

      const [groups] = await pool.query(
        `SELECT 
        g.group_id,
        g.group_name,
        g.group_title,
        g.group_privacy,
        g.group_picture,
        g.group_members,
        g.group_date,
        gm.approved,
        (SELECT 1 FROM groups_admins ga 
         WHERE ga.group_id = g.group_id AND ga.user_id = ?) as is_admin
       FROM groups_members gm
       JOIN \`groups\` g ON g.group_id = gm.group_id
       WHERE gm.user_id = ? 
       AND NOT g.group_title LIKE '[Deleted] %' 
       ${!canViewAll ? 'AND g.group_privacy = "public"' : ""}
       ORDER BY 
         CASE WHEN gm.approved = '1' THEN 0 ELSE 1 END,
         g.group_title`,
        [effectiveUserId, effectiveUserId]
      );

      // Generate URLs for groups with storage data
      for (const group of groups) {
        if (group.group_picture || group.group_cover) {
          const [storageData] = await pool.query(
            `SELECT * FROM group_storage_data WHERE group_id = ?`,
            [group.group_id]
          );

          if (storageData.length > 0) {
            const sd = storageData[0];

            if (group.group_picture && sd.picture_storage_type) {
              group.group_picture_url = storageManager.getPublicUrl(
                sd.picture_storage_type,
                group.group_picture
              );
            }

            if (group.group_cover && sd.cover_storage_type) {
              group.group_cover_url = storageManager.getPublicUrl(
                sd.cover_storage_type,
                group.group_cover
              );
            }
          }
        }
      }

      res.json({
        success: true,
        data: {
          groups,
          user_id: effectiveUserId,
          is_viewing_self: isViewingSelf,
          total_count: groups.length,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // In GroupController.js - add this method
  static async getDeletedGroups(req, res, next) {
    try {
      const userId = GroupController.getCurrentUserId(req);
      if (!userId) {
        throw new UnauthorizedError("Authentication required");
      }

      // Get deleted groups with basic info
      const [deletedGroups] = await pool.query(
        `SELECT 
        g.group_id,
        g.group_name,
        g.group_title,
        g.group_picture,
        g.group_members,
        g.group_date,
        g.group_admin,
        DATE(
          CASE 
            WHEN g.group_name LIKE 'deleted_%' 
            THEN FROM_UNIXTIME(SUBSTRING_INDEX(SUBSTRING_INDEX(g.group_name, '_', 2), '_', -1) / 1000)
            ELSE g.group_date
          END
        ) as deletion_date
       FROM \`groups\` g
       WHERE g.group_admin = ? 
       AND g.group_title LIKE '[Deleted] %'
       ORDER BY deletion_date DESC`,
        [userId]
      );

      // Process groups
      const processedGroups = [];
      let totalMembers = 0;
      let canRestoreCount = 0;
      let canPermanentlyDeleteCount = 0;

      for (const group of deletedGroups) {
        // Calculate days since deletion
        const deletionDate = new Date(group.deletion_date || group.group_date);
        const today = new Date();
        const daysSinceDeletion = Math.floor(
          (today - deletionDate) / (1000 * 60 * 60 * 24)
        );

        const canPermanentlyDelete = daysSinceDeletion >= 30;
        const canRestore = !canPermanentlyDelete;

        // Add to counts
        totalMembers += group.group_members || 0;
        if (canRestore) canRestoreCount++;
        if (canPermanentlyDelete) canPermanentlyDeleteCount++;

        // Add basic group info
        processedGroups.push({
          group_id: group.group_id,
          group_title: group.group_title,
          group_picture: group.group_picture,
          group_members: group.group_members || 0,
          days_since_deletion: daysSinceDeletion,
          can_restore: canRestore,
          can_permanently_delete: canPermanentlyDelete,
          deletion_date: group.deletion_date,
        });
      }

      res.json({
        success: true,
        data: {
          deleted_groups: processedGroups,
          count: deletedGroups.length,
          summary: {
            total_deleted: deletedGroups.length,
            can_restore: canRestoreCount,
            can_permanently_delete: canPermanentlyDeleteCount,
            total_members: totalMembers,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async restoreGroup(req, res, next) {
    const connection = await pool.getConnection();
    try {
      const { groupId } = req.params;
      const userId = GroupController.getCurrentUserId(req);

      // Check if user is creator
      if (!(await GroupController.isUserCreator(groupId, userId))) {
        throw new UnauthorizedError(
          "Only the group creator can restore the group"
        );
      }

      await connection.beginTransaction();

      // Get current group name
      const [group] = await connection.query(
        "SELECT group_title FROM `groups` WHERE group_id = ?",
        [groupId]
      );

      if (group.length === 0) {
        throw new GroupNotFoundError();
      }

      // Remove "[Deleted] " prefix and restore original name
      const currentTitle = group[0].group_title;
      const originalTitle = currentTitle.replace("[Deleted] ", "");

      // Extract original group_name from deleted_name
      const [deletedInfo] = await connection.query(
        "SELECT group_name FROM `groups` WHERE group_id = ?",
        [groupId]
      );

      let originalName = deletedInfo[0].group_name;
      if (originalName.startsWith("deleted_")) {
        // Extract original name: deleted_TIMESTAMP_originalname
        const parts = originalName.split("_");
        originalName = parts.slice(2).join("_"); // Get everything after timestamp
      }

      // Restore the group
      await connection.query(
        `UPDATE \`groups\` SET 
        group_title = ?,
        group_name = ?
       WHERE group_id = ?`,
        [originalTitle, originalName, groupId]
      );

      await connection.commit();

      res.json({
        success: true,
        message: "Group restored successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // Helper: Check if two users are friends
  static async areFriends(userId1, userId2) {
    if (!userId1 || !userId2) return false;
    const [friendship] = await pool.query(
      `SELECT 1 FROM friends 
       WHERE (user_one_id = ? AND user_two_id = ?) 
       OR (user_one_id = ? AND user_two_id = ?)
       AND status = 1`,
      [userId1, userId2, userId2, userId1]
    );
    return friendship.length > 0;
  }

  // 13. HANDLE JOIN REQUEST
  static async handleJoinRequest(req, res, next) {
    const connection = await pool.getConnection();
    try {
      const { groupId, memberId } = req.params;
      const { action } = req.body;
      const userId = GroupController.getCurrentUserId(req);

      if (!(await GroupController.isUserAdmin(groupId, userId))) {
        throw new UnauthorizedError("Only admins can manage requests");
      }

      if (!["approve", "reject"].includes(action)) {
        throw new ValidationError("Action must be 'approve' or 'reject'");
      }

      await connection.beginTransaction();

      const [member] = await connection.query(
        "SELECT user_id, approved FROM groups_members WHERE id = ? AND group_id = ?",
        [memberId, groupId]
      );

      if (member.length === 0) {
        throw new ValidationError("Member request not found");
      }

      if (action === "approve") {
        await connection.query(
          "UPDATE groups_members SET approved = ? WHERE id = ?",
          ["1", memberId]
        );

        await connection.query(
          "UPDATE `groups` SET group_members = group_members + 1 WHERE group_id = ?",
          [groupId]
        );

        await connection.query(
          `INSERT INTO notifications 
           (to_user_id, from_user_id, from_user_type, action, node_type, node_url, time)
           VALUES (?, ?, 'user', 'group_join_approved', 'group', CONCAT('/groups/', ?), NOW())`,
          [member[0].user_id, userId, groupId]
        );
      } else {
        await connection.query(
          "DELETE FROM groups_members WHERE id = ? AND group_id = ?",
          [memberId, groupId]
        );

        await connection.query(
          `INSERT INTO notifications 
           (to_user_id, from_user_id, from_user_type, action, node_type, node_url, message, time)
           VALUES (?, ?, 'user', 'group_join_rejected', 'group', CONCAT('/groups/', ?), 'Your join request was not approved', NOW())`,
          [member[0].user_id, userId, groupId]
        );
      }

      await connection.commit();

      res.json({
        success: true,
        message: action === "approve" ? "Member approved" : "Request rejected",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 14. ADD ADMIN
  static async addAdmin(req, res, next) {
    const connection = await pool.getConnection();
    try {
      const { groupId } = req.params;
      const { userId: newAdminId } = req.body;
      const userId = GroupController.getCurrentUserId(req);

      if (!(await GroupController.isUserAdmin(groupId, userId))) {
        throw new UnauthorizedError("Only admins can add admins");
      }

      if (!(await GroupController.isUserMember(groupId, newAdminId))) {
        throw new ValidationError("User must be a member to become admin");
      }

      if (await GroupController.isUserAdmin(groupId, newAdminId)) {
        throw new ValidationError("User is already an admin");
      }

      await connection.query(
        "INSERT INTO groups_admins (group_id, user_id) VALUES (?, ?)",
        [groupId, newAdminId]
      );

      await connection.query(
        `INSERT INTO notifications 
         (to_user_id, from_user_id, from_user_type, action, node_type, node_url, time)
         VALUES (?, ?, 'user', 'made_group_admin', 'group', CONCAT('/groups/', ?), NOW())`,
        [newAdminId, userId, groupId]
      );

      res.json({
        success: true,
        message: "Admin added successfully",
      });
    } catch (error) {
      next(error);
    } finally {
      connection.release();
    }
  }

  // 15. GET GROUP CATEGORIES
  static async getCategories(req, res, next) {
    try {
      const { parentId } = req.query;

      const whereClause = parentId
        ? "WHERE category_parent_id = ?"
        : "WHERE category_parent_id = 0";

      const [categories] = await pool.query(
        `SELECT 
          gc.*,
          (SELECT COUNT(*) FROM \`groups\` g WHERE g.group_category = gc.category_id) as group_count
         FROM groups_categories gc
         ${whereClause}
         ORDER BY category_order, category_name`,
        parentId ? [parentId] : []
      );

      res.json({
        success: true,
        data: {
          categories,
          total: categories.length,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 16. PIN POST
  static async pinPost(req, res, next) {
    try {
      const { groupId } = req.params;
      const { postId } = req.body;
      const userId = GroupController.getCurrentUserId(req);

      if (!(await GroupController.isUserAdmin(groupId, userId))) {
        throw new UnauthorizedError("Only admins can pin posts");
      }

      const [post] = await pool.query(
        "SELECT 1 FROM posts WHERE post_id = ? AND group_id = ?",
        [postId, groupId]
      );

      if (post.length === 0) {
        throw new ValidationError("Post not found in this group");
      }

      await pool.query(
        "UPDATE `groups` SET group_pinned_post = ? WHERE group_id = ?",
        [postId, groupId]
      );

      res.json({
        success: true,
        message: "Post pinned successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  // 17. RATE GROUP
  static async rateGroup(req, res, next) {
    const connection = await pool.getConnection();
    try {
      const { groupId } = req.params;
      const { rating } = req.body;
      const userId = GroupController.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedError("Authentication required");
      }

      if (!(await GroupController.isUserMember(groupId, userId))) {
        throw new UnauthorizedError("Must be a member to rate the group");
      }

      if (rating < 1 || rating > 5) {
        throw new ValidationError("Rating must be between 1 and 5");
      }

      await connection.beginTransaction();

      const [existingReview] = await connection.query(
        "SELECT review_id FROM reviews WHERE node_id = ? AND node_type = 'group' AND user_id = ?",
        [groupId, userId]
      );

      if (existingReview.length > 0) {
        await connection.query(
          "UPDATE reviews SET rate = ?, review = '', time = NOW() WHERE review_id = ?",
          [rating, existingReview[0].review_id]
        );
      } else {
        await connection.query(
          "INSERT INTO reviews (node_id, node_type, user_id, rate, review, time) VALUES (?, 'group', ?, ?, '', NOW())",
          [groupId, userId, rating]
        );
      }

      const [avgRating] = await connection.query(
        "SELECT AVG(rate) as average FROM reviews WHERE node_id = ? AND node_type = 'group'",
        [groupId]
      );

      await connection.query(
        "UPDATE `groups` SET group_rate = ? WHERE group_id = ?",
        [avgRating[0].average || 0, groupId]
      );

      await connection.commit();

      res.json({
        success: true,
        message: "Group rated successfully",
        data: {
          rating,
          average_rating: avgRating[0].average || 0,
        },
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }
  // Add this new method to your GroupController
  static async getPendingRequests(req, res, next) {
    try {
      const { groupId } = req.params;
      const userId = GroupController.getCurrentUserId(req);
      const { page = 1, limit = 50, search = "" } = req.query;

      const offset = (page - 1) * limit;

      // Check if user is admin
      if (!(await GroupController.isUserAdmin(groupId, userId))) {
        throw new UnauthorizedError("Only admins can view pending requests");
      }

      // Build query specifically for pending requests
      let whereClauses = [
        "gm.group_id = ?",
        'gm.approved = "0"', // Only pending requests
      ];

      const values = [groupId];

      if (search) {
        whereClauses.push(
          "(u.user_name LIKE ? OR u.user_firstname LIKE ? OR u.user_lastname LIKE ?)"
        );
        const searchTerm = `%${search}%`;
        values.push(searchTerm, searchTerm, searchTerm);
      }

      // Get total count
      const [countResult] = await pool.query(
        `SELECT COUNT(*) as total 
       FROM groups_members gm
       JOIN users u ON u.user_id = gm.user_id
       WHERE ${whereClauses.join(" AND ")}`,
        values
      );

      const total = countResult[0].total;
      const totalPages = Math.ceil(total / limit);

      // Get pending requests
      const [pendingRequests] = await pool.query(
        `SELECT 
        u.user_id,
        u.user_name,
        u.user_firstname,
        u.user_lastname,
        u.user_picture,
        u.user_verified,
        u.user_last_seen,
        gm.approved,
        gm.id as membership_id,
        gm.requested_at,
        TIMESTAMPDIFF(DAY, gm.requested_at, NOW()) as days_ago
       FROM groups_members gm
       JOIN users u ON u.user_id = gm.user_id
       WHERE ${whereClauses.join(" AND ")}
       ORDER BY gm.requested_at DESC
       LIMIT ? OFFSET ?`,
        [...values, parseInt(limit), offset]
      );

      res.json({
        success: true,
        data: {
          pending_requests: pendingRequests,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            total_pages: totalPages,
            has_next: page < totalPages,
            has_prev: page > 1,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
  // 18. GET GROUP EVENTS
  static async getGroupEvents(req, res, next) {
    try {
      const { groupId } = req.params;
      const userId = GroupController.getCurrentUserId(req);
      const { page = 1, limit = 20, status = "upcoming" } = req.query;
      const offset = (page - 1) * limit;

      const isMember = await GroupController.isUserMember(groupId, userId);
      const isAdmin = await GroupController.isUserAdmin(groupId, userId);

      const [group] = await pool.query(
        "SELECT group_privacy FROM `groups` WHERE group_id = ?",
        [groupId]
      );

      if (group.length === 0) {
        throw new GroupNotFoundError();
      }

      if (group[0].group_privacy === "secret" && !isMember && !isAdmin) {
        throw new UnauthorizedError("You don't have permission to view events");
      }

      let whereClause = "e.event_page_id IS NULL";
      const values = [];

      if (status === "upcoming") {
        whereClause += " AND e.event_start_date >= NOW()";
      } else if (status === "past") {
        whereClause += " AND e.event_start_date < NOW()";
      }

      // Get total count
      const [countResult] = await pool.query(
        `SELECT COUNT(*) as total 
         FROM events e
         WHERE ${whereClause}`,
        values
      );

      const total = countResult[0].total;
      const totalPages = Math.ceil(total / limit);

      // Get events
      const [events] = await pool.query(
        `SELECT 
          e.*,
          ec.category_name,
          (SELECT COUNT(*) FROM events_members em 
           WHERE em.event_id = e.event_id AND em.is_going = '1') as going_count,
          (SELECT 1 FROM events_members em 
           WHERE em.event_id = e.event_id AND em.user_id = ? AND em.is_going = '1') as user_going,
          (SELECT 1 FROM events_members em 
           WHERE em.event_id = e.event_id AND em.user_id = ? AND em.is_interested = '1') as user_interested
         FROM events e
         LEFT JOIN events_categories ec ON ec.category_id = e.event_category
         WHERE ${whereClause}
         ORDER BY e.event_start_date ${status === "upcoming" ? "ASC" : "DESC"}
         LIMIT ? OFFSET ?`,
        [...values, userId || 0, userId || 0, parseInt(limit), offset]
      );

      res.json({
        success: true,
        data: {
          events,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            total_pages: totalPages,
            has_next: page < totalPages,
            has_prev: page > 1,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 19. GET GROUP ALBUMS
  static async getGroupAlbums(req, res, next) {
    try {
      const { groupId } = req.params;
      const userId = GroupController.getCurrentUserId(req);
      const { page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      const isMember = await GroupController.isUserMember(groupId, userId);
      const isAdmin = await GroupController.isUserAdmin(groupId, userId);

      const [group] = await pool.query(
        "SELECT group_privacy FROM `groups` WHERE group_id = ?",
        [groupId]
      );

      if (group.length === 0) {
        throw new GroupNotFoundError();
      }

      if (group[0].group_privacy === "secret" && !isMember && !isAdmin) {
        throw new UnauthorizedError("You don't have permission to view albums");
      }

      // Get total count
      const [countResult] = await pool.query(
        `SELECT COUNT(*) as total 
         FROM posts_photos_albums ppa
         WHERE ppa.group_id = ? AND ppa.in_group = '1'`,
        [groupId]
      );

      const total = countResult[0].total;
      const totalPages = Math.ceil(total / limit);

      // Get albums
      const [albums] = await pool.query(
        `SELECT 
          ppa.*,
          u.user_name,
          u.user_picture,
          (SELECT COUNT(*) FROM posts_photos pp 
           WHERE pp.album_id = ppa.album_id) as photo_count,
          (SELECT source FROM posts_photos pp 
           WHERE pp.album_id = ppa.album_id 
           ORDER BY pp.photo_id DESC LIMIT 1) as last_photo
         FROM posts_photos_albums ppa
         JOIN users u ON u.user_id = ppa.user_id
         WHERE ppa.group_id = ? AND ppa.in_group = '1'
         ORDER BY ppa.album_id DESC
         LIMIT ? OFFSET ?`,
        [groupId, parseInt(limit), offset]
      );

      res.json({
        success: true,
        data: {
          albums,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            total_pages: totalPages,
            has_next: page < totalPages,
            has_prev: page > 1,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 20. TOGGLE CHATBOX
  static async toggleChatbox(req, res, next) {
    try {
      const { groupId } = req.params;
      const { enabled } = req.body;
      const userId = GroupController.getCurrentUserId(req);

      if (!(await GroupController.isUserAdmin(groupId, userId))) {
        throw new UnauthorizedError("Only admins can manage chatbox");
      }

      await pool.query(
        "UPDATE `groups` SET chatbox_enabled = ? WHERE group_id = ?",
        [enabled ? "1" : "0", groupId]
      );

      res.json({
        success: true,
        message: `Chatbox ${enabled ? "enabled" : "disabled"}`,
      });
    } catch (error) {
      next(error);
    }
  }
}

// Error handling middleware
GroupController.handleError = (err, req, res, next) => {
  console.error(err);

  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal server error";

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      type: err.name,
      ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
    },
  });
};

module.exports = GroupController;
