const pool = require("../config/db");
const { logActivity } = require("../services/activityLogger");
const PostService = require("../services/Postservice");
const storageManager = require("../utils/storageManager");
const path = require("path");
const fs = require("fs").promises;

// Custom Errors
class EventError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
  }
}

class EventNotFoundError extends EventError {
  constructor(message = "Event not found") {
    super(message, 404);
  }
}

class UnauthorizedEventError extends EventError {
  constructor(message = "Unauthorized access") {
    super(message, 403);
  }
}

class ValidationEventError extends EventError {
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

class EventsController {
  // Helper: Get current user ID
  static getCurrentUserId(req) {
    return (
      req.user?.id || req.user?.user_id || req.user?.uid || req.userId || null
    );
  }

  // Helper: Check if user is event admin
  static async isUserAdmin(eventId, userId) {
    if (!userId) return false;
    const [event] = await pool.query(
      `SELECT event_admin FROM events WHERE event_id = ?`,
      [eventId],
    );
    return event.length > 0 && event[0].event_admin === userId;
  }

  // Helper: Check if user is event member
  static async isUserMember(eventId, userId) {
    if (!userId) return false;
    const [member] = await pool.query(
      `SELECT 1 FROM events_members 
       WHERE event_id = ? AND user_id = ? AND (is_going = '1' OR is_interested = '1')`,
      [eventId, userId],
    );
    return member.length > 0;
  }

  // Helper: Check if user is invited
  static async isUserInvited(eventId, userId) {
    if (!userId) return false;
    const [invite] = await pool.query(
      `SELECT 1 FROM events_members 
       WHERE event_id = ? AND user_id = ? AND is_invited = '1'`,
      [eventId, userId],
    );
    return invite.length > 0;
  }

  // Helper: Check if user is going
  static async isUserGoing(eventId, userId) {
    if (!userId) return false;
    const [going] = await pool.query(
      `SELECT 1 FROM events_members 
       WHERE event_id = ? AND user_id = ? AND is_going = '1'`,
      [eventId, userId],
    );
    return going.length > 0;
  }

  // Helper: Check if user is interested
  static async isUserInterested(eventId, userId) {
    if (!userId) return false;
    const [interested] = await pool.query(
      `SELECT 1 FROM events_members 
       WHERE event_id = ? AND user_id = ? AND is_interested = '1'`,
      [eventId, userId],
    );
    return interested.length > 0;
  }

  // Helper: Check event privacy
  static async checkEventPrivacy(eventId, userId) {
    const [event] = await pool.query(
      `SELECT event_privacy FROM events WHERE event_id = ?`,
      [eventId],
    );

    if (event.length === 0) return false;

    const privacy = event[0].event_privacy;

    // Public events are visible to everyone
    if (privacy === "public") return true;

    // If no user ID, can't access non-public events
    if (!userId) return false;

    // Admin can see everything
    if (await EventsController.isUserAdmin(eventId, userId)) return true;

    // For closed events, need to be invited or member
    if (privacy === "closed") {
      return (
        (await EventsController.isUserInvited(eventId, userId)) ||
        (await EventsController.isUserMember(eventId, userId))
      );
    }

    // For secret events, must be going or interested
    if (privacy === "secret") {
      return (
        (await EventsController.isUserGoing(eventId, userId)) ||
        (await EventsController.isUserInterested(eventId, userId))
      );
    }

    return false;
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
      throw new ValidationEventError(`Failed to upload file: ${error.message}`);
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

  // 1. CREATE EVENT
  static async createEvent(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const userId = EventsController.getCurrentUserId(req);
      if (!userId) {
        throw new UnauthorizedEventError("Authentication required");
      }

      const {
        event_title,
        event_description,
        event_category,
        event_privacy = "public",
        event_location,
        event_start_date,
        event_end_date,
        event_publish_enabled = "1",
        event_publish_approval_enabled = "0",
        event_tickets_link,
        event_prices,
        chatbox_enabled = "0",
      } = req.body;

      // Validate required fields
      if (!event_title?.trim()) {
        throw new ValidationEventError("Event title is required");
      }

      if (!event_description?.trim()) {
        throw new ValidationEventError("Event description is required");
      }

      if (!event_category) {
        throw new ValidationEventError("Event category is required");
      }

      if (!event_start_date) {
        throw new ValidationEventError("Event start date is required");
      }

      if (!event_end_date) {
        throw new ValidationEventError("Event end date is required");
      }

      const startDate = new Date(event_start_date);
      const endDate = new Date(event_end_date);

      if (startDate >= endDate) {
        throw new ValidationEventError("End date must be after start date");
      }

      // Handle event cover upload
      let eventCoverResult = null;
      if (req.files?.event_cover?.[0]) {
        const coverFile = req.files.event_cover[0];
        coverFile.originalname = `event-cover-${Date.now()}-${coverFile.originalname}`;
        eventCoverResult = await storageManager.upload(
          coverFile,
          "events/event-covers",
        );
      }

      // Create event
      const [result] = await connection.query(
        `INSERT INTO events (
          event_privacy, event_admin, event_category, event_title,
          event_location, event_description, event_start_date,
          event_end_date, event_publish_enabled, event_publish_approval_enabled,
          event_cover, chatbox_enabled, event_tickets_link,
          event_prices, event_invited, event_interested, event_going,
          event_rate, event_date
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,0,NOW())`,
        [
          event_privacy,
          userId,
          event_category,
          event_title,
          event_location || null,
          event_description,
          event_start_date,
          event_end_date,
          normalizeEnum01(event_publish_enabled),
          normalizeEnum01(event_publish_approval_enabled),
          eventCoverResult ? eventCoverResult.path : null,
          normalizeEnum01(chatbox_enabled),
          event_tickets_link || null,
          event_prices || null,
        ],
      );

      const eventId = result.insertId;

      // Create default photo albums for event
      await connection.query(
        `INSERT INTO posts_photos_albums 
         (title, user_id, user_type, in_group, group_id, in_event, event_id, privacy) 
         VALUES 
         ('Event Covers', ?, 'user', '0', NULL, '1', ?, 'public'),
         ('Event Timeline', ?, 'user', '0', NULL, '1', ?, 'public')`,
        [userId, eventId, userId, eventId],
      );

      // Update album IDs in events table
      const [albums] = await connection.query(
        `SELECT album_id FROM posts_photos_albums 
         WHERE event_id = ? ORDER BY album_id ASC`,
        [eventId],
      );

      if (albums.length >= 2) {
        await connection.query(
          "UPDATE events SET event_album_covers = ?, event_album_timeline = ? WHERE event_id = ?",
          [albums[0].album_id, albums[1].album_id, eventId],
        );
      }

      // Add creator as going
      await connection.query(
        `INSERT INTO events_members (event_id, user_id, is_going) 
         VALUES (?, ?, '1')`,
        [eventId, userId],
      );

      // Update going count
      await connection.query(
        "UPDATE events SET event_going = event_going + 1 WHERE event_id = ?",
        [eventId],
      );

      await connection.commit();

      // Log activity
      await logActivity(
        userId,
        "event_create",
        `Created event: ${event_title}`,
        eventId,
        "event",
      );

      res.status(201).json({
        success: true,
        message: "Event created successfully",
        data: {
          event_id: eventId,
          event_title,
          event_privacy,
          event_cover_url: eventCoverResult
            ? await storageManager.getPublicUrl(
                eventCoverResult.storage_type,
                eventCoverResult.path,
                eventCoverResult.storage_data,
              )
            : null,
          url: `/events/${eventId}`,
        },
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 2. GET ALL EVENTS
  static async getAllEvents(req, res, next) {
    try {
      const userId = EventsController.getCurrentUserId(req);
      const { page = 1, limit = 20, category, privacy, upcoming } = req.query;

      const offset = (page - 1) * limit;

      let query = `
        SELECT e.*, 
               ec.category_name,
               COUNT(DISTINCT em_going.user_id) as going_count,
               COUNT(DISTINCT em_interested.user_id) as interested_count,
               (CASE 
                  WHEN ? > 0 THEN 
                    (SELECT is_going FROM events_members WHERE event_id = e.event_id AND user_id = ?)
                  ELSE NULL 
                END) as user_going,
               (CASE 
                  WHEN ? > 0 THEN 
                    (SELECT is_interested FROM events_members WHERE event_id = e.event_id AND user_id = ?)
                  ELSE NULL 
                END) as user_interested
        FROM events e
        LEFT JOIN events_categories ec ON e.event_category = ec.category_id
        LEFT JOIN events_members em_going ON e.event_id = em_going.event_id AND em_going.is_going = '1'
        LEFT JOIN events_members em_interested ON e.event_id = em_interested.event_id AND em_interested.is_interested = '1'
        WHERE 1=1
      `;

      const queryParams = [userId || 0, userId || 0, userId || 0, userId || 0];

      // Apply privacy filters
      if (userId) {
        query += ` AND (
          e.event_privacy = 'public' 
          OR e.event_admin = ?
          OR EXISTS (
            SELECT 1 FROM events_members em 
            WHERE em.event_id = e.event_id 
            AND em.user_id = ? 
            AND (em.is_going = '1' OR em.is_interested = '1')
          )
        )`;
        queryParams.push(userId, userId);
      } else {
        query += ` AND e.event_privacy = 'public'`;
      }

      // Apply category filter
      if (category) {
        query += ` AND e.event_category = ?`;
        queryParams.push(category);
      }

      // Apply privacy filter
      if (privacy) {
        query += ` AND e.event_privacy = ?`;
        queryParams.push(privacy);
      }

      // Apply upcoming filter
      if (upcoming === "true") {
        query += ` AND e.event_start_date > NOW()`;
      }

      query += ` GROUP BY e.event_id ORDER BY e.event_date DESC LIMIT ? OFFSET ?`;
      queryParams.push(parseInt(limit), parseInt(offset));

      const [events] = await pool.query(query, queryParams);

      // Get total count
      const [countResult] = await pool.query(
        `SELECT COUNT(*) as total FROM events e WHERE 1=1 ${
          userId
            ? `AND (e.event_privacy = 'public' OR e.event_admin = ?)`
            : `AND e.event_privacy = 'public'`
        }`,
        userId ? [userId] : [],
      );

      // Process event covers
      const processedEvents = await Promise.all(
        events.map(async (event) => {
          if (event.event_cover) {
            try {
              event.event_cover_url = await storageManager.getPublicUrl(
                event.event_cover_storage_type || "local",
                event.event_cover,
                event.event_cover_storage_data,
              );
            } catch (error) {
              event.event_cover_url = null;
            }
          }
          return event;
        }),
      );

      res.json({
        success: true,
        data: processedEvents,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult[0].total,
          totalPages: Math.ceil(countResult[0].total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 3. GET EVENT BY ID
  static async getEventById(req, res, next) {
    try {
      const { eventId } = req.params;
      const userId = EventsController.getCurrentUserId(req);

      // Check event existence and access
      const [events] = await pool.query(
        `SELECT e.*, 
                ec.category_name,
                u.user_name as admin_username,
                u.user_firstname as admin_firstname,
                u.user_lastname as admin_lastname,
                u.user_picture as admin_picture
         FROM events e
         LEFT JOIN events_categories ec ON e.event_category = ec.category_id
         LEFT JOIN users u ON e.event_admin = u.user_id
         WHERE e.event_id = ?`,
        [eventId],
      );

      if (events.length === 0) {
        throw new EventNotFoundError();
      }

      const event = events[0];

      // Check privacy
      const canAccess = await EventsController.checkEventPrivacy(
        eventId,
        userId,
      );
      if (!canAccess) {
        throw new UnauthorizedEventError("You don't have access to this event");
      }

      // Get member counts
      const [[goingCount]] = await pool.query(
        "SELECT COUNT(*) as count FROM events_members WHERE event_id = ? AND is_going = '1'",
        [eventId],
      );

      const [[interestedCount]] = await pool.query(
        "SELECT COUNT(*) as count FROM events_members WHERE event_id = ? AND is_interested = '1'",
        [eventId],
      );

      const [[invitedCount]] = await pool.query(
        "SELECT COUNT(*) as count FROM events_members WHERE event_id = ? AND is_invited = '1'",
        [eventId],
      );

      // Get user status
      let userStatus = null;
      if (userId) {
        const [userStatusRows] = await pool.query(
          `SELECT is_going, is_interested, is_invited 
           FROM events_members 
           WHERE event_id = ? AND user_id = ?`,
          [eventId, userId],
        );

        if (userStatusRows.length > 0) {
          userStatus = {
            is_going: userStatusRows[0].is_going === "1",
            is_interested: userStatusRows[0].is_interested === "1",
            is_invited: userStatusRows[0].is_invited === "1",
          };
        }
      }

      // Process event cover
      if (event.event_cover) {
        try {
          event.event_cover_url = await storageManager.getPublicUrl(
            event.event_cover_storage_type || "local",
            event.event_cover,
            event.event_cover_storage_data,
          );
        } catch (error) {
          event.event_cover_url = null;
        }
      }

      // Process admin picture
      if (event.admin_picture) {
        try {
          event.admin_picture_url = await storageManager.getPublicUrl(
            "local",
            event.admin_picture,
          );
        } catch (error) {
          event.admin_picture_url = null;
        }
      }

      res.json({
        success: true,
        data: {
          ...event,
          going_count: goingCount.count,
          interested_count: interestedCount.count,
          invited_count: invitedCount.count,
          user_status: userStatus,
          is_admin: userId
            ? await EventsController.isUserAdmin(eventId, userId)
            : false,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 4. UPDATE EVENT
  static async updateEvent(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { eventId } = req.params;
      const userId = EventsController.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedEventError("Authentication required");
      }

      // Check if user is admin
      const isAdmin = await EventsController.isUserAdmin(eventId, userId);
      if (!isAdmin) {
        throw new UnauthorizedEventError(
          "Only event admins can update the event",
        );
      }

      // Get current event data
      const [events] = await connection.query(
        "SELECT * FROM events WHERE event_id = ?",
        [eventId],
      );

      if (events.length === 0) {
        throw new EventNotFoundError();
      }

      const currentEvent = events[0];

      // Prepare update data
      const {
        event_title,
        event_description,
        event_category,
        event_privacy,
        event_location,
        event_start_date,
        event_end_date,
        event_publish_enabled,
        event_publish_approval_enabled,
        event_tickets_link,
        event_prices,
        chatbox_enabled,
        event_cover_position,
      } = req.body;

      // Validate dates if provided
      if (event_start_date || event_end_date) {
        const startDate = new Date(
          event_start_date || currentEvent.event_start_date,
        );
        const endDate = new Date(event_end_date || currentEvent.event_end_date);

        if (startDate >= endDate) {
          throw new ValidationEventError("End date must be after start date");
        }
      }

      // Handle event cover upload
      let eventCoverResult = null;
      let oldCoverPath = currentEvent.event_cover;
      let oldCoverStorageType = currentEvent.event_cover_storage_type;
      let oldCoverStorageData = currentEvent.event_cover_storage_data;

      if (req.files?.event_cover?.[0]) {
        const coverFile = req.files.event_cover[0];
        coverFile.originalname = `event-cover-${Date.now()}-${coverFile.originalname}`;
        eventCoverResult = await storageManager.upload(
          coverFile,
          "events/event-covers",
        );

        // Delete old cover if exists
        if (oldCoverPath) {
          await EventsController.deleteOldFile(
            oldCoverStorageType,
            oldCoverPath,
          );
        }
      }

      // Prepare update fields
      const updateFields = [];
      const updateValues = [];

      if (event_title !== undefined) {
        updateFields.push("event_title = ?");
        updateValues.push(event_title);
      }

      if (event_description !== undefined) {
        updateFields.push("event_description = ?");
        updateValues.push(event_description);
      }

      if (event_category !== undefined) {
        updateFields.push("event_category = ?");
        updateValues.push(event_category);
      }

      if (event_privacy !== undefined) {
        updateFields.push("event_privacy = ?");
        updateValues.push(event_privacy);
      }

      if (event_location !== undefined) {
        updateFields.push("event_location = ?");
        updateValues.push(event_location);
      }

      if (event_start_date !== undefined) {
        updateFields.push("event_start_date = ?");
        updateValues.push(event_start_date);
      }

      if (event_end_date !== undefined) {
        updateFields.push("event_end_date = ?");
        updateValues.push(event_end_date);
      }

      if (event_publish_enabled !== undefined) {
        updateFields.push("event_publish_enabled = ?");
        updateValues.push(normalizeEnum01(event_publish_enabled));
      }

      if (event_publish_approval_enabled !== undefined) {
        updateFields.push("event_publish_approval_enabled = ?");
        updateValues.push(normalizeEnum01(event_publish_approval_enabled));
      }

      if (eventCoverResult) {
        updateFields.push("event_cover = ?");
        updateFields.push("event_cover_storage_type = ?");
        updateFields.push("event_cover_storage_data = ?");
        updateValues.push(eventCoverResult.path);
        updateValues.push(eventCoverResult.storage_type);
        updateValues.push(JSON.stringify(eventCoverResult.storage_data));
      }

      if (event_cover_position !== undefined) {
        updateFields.push("event_cover_position = ?");
        updateValues.push(event_cover_position);
      }

      if (chatbox_enabled !== undefined) {
        updateFields.push("chatbox_enabled = ?");
        updateValues.push(normalizeEnum01(chatbox_enabled));
      }

      if (event_tickets_link !== undefined) {
        updateFields.push("event_tickets_link = ?");
        updateValues.push(event_tickets_link);
      }

      if (event_prices !== undefined) {
        updateFields.push("event_prices = ?");
        updateValues.push(event_prices);
      }

      if (updateFields.length === 0) {
        throw new ValidationEventError("No fields to update");
      }

      updateValues.push(eventId);

      // Execute update
      await connection.query(
        `UPDATE events SET ${updateFields.join(", ")} WHERE event_id = ?`,
        updateValues,
      );

      await connection.commit();

      // Log activity
      await logActivity(
        userId,
        "event_update",
        `Updated event: ${event_title || currentEvent.event_title}`,
        eventId,
        "event",
      );

      res.json({
        success: true,
        message: "Event updated successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 5. DELETE EVENT
  static async deleteEvent(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { eventId } = req.params;
      const userId = EventsController.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedEventError("Authentication required");
      }

      // Check if user is admin
      const isAdmin = await EventsController.isUserAdmin(eventId, userId);
      if (!isAdmin) {
        throw new UnauthorizedEventError(
          "Only event admins can delete the event",
        );
      }

      // Get event details for logging
      const [events] = await connection.query(
        "SELECT event_title, event_cover, event_cover_storage_type, event_cover_storage_data FROM events WHERE event_id = ?",
        [eventId],
      );

      if (events.length === 0) {
        throw new EventNotFoundError();
      }

      const event = events[0];

      // Delete event cover
      if (event.event_cover) {
        await EventsController.deleteOldFile(
          event.event_cover_storage_type,
          event.event_cover,
        );
      }

      // Delete event records
      await connection.query("DELETE FROM events WHERE event_id = ?", [
        eventId,
      ]);
      await connection.query("DELETE FROM events_members WHERE event_id = ?", [
        eventId,
      ]);

      // Delete related posts
      const [posts] = await connection.query(
        "SELECT post_id FROM posts WHERE event_id = ?",
        [eventId],
      );

      for (const post of posts) {
        await PostService.deletePost(post.post_id, connection);
      }

      // Delete photo albums
      await connection.query(
        "DELETE FROM posts_photos_albums WHERE event_id = ?",
        [eventId],
      );

      await connection.commit();

      // Log activity
      await logActivity(
        userId,
        "event_delete",
        `Deleted event: ${event.event_title}`,
        eventId,
        "event",
      );

      res.json({
        success: true,
        message: "Event deleted successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 6. GET EVENT MEMBERS
  static async getEventMembers(req, res, next) {
    try {
      const { eventId } = req.params;
      const userId = EventsController.getCurrentUserId(req);
      const {
        type = "all", // 'going', 'interested', 'invited', 'all'
        page = 1,
        limit = 20,
      } = req.query;

      const offset = (page - 1) * limit;

      // Check event existence
      const [events] = await pool.query(
        "SELECT event_privacy FROM events WHERE event_id = ?",
        [eventId],
      );

      if (events.length === 0) {
        throw new EventNotFoundError();
      }

      // Check privacy
      const canAccess = await EventsController.checkEventPrivacy(
        eventId,
        userId,
      );
      if (!canAccess) {
        throw new UnauthorizedEventError("You don't have access to this event");
      }

      // Build query based on type
      let memberQuery = `
        SELECT em.*, 
               u.user_id, u.user_name, u.user_firstname, u.user_lastname, 
               u.user_picture, u.user_cover, u.user_verified,
               (u.user_id = ?) as is_self,
               (SELECT 1 FROM users_blocks WHERE user_id = ? AND blocked_id = u.user_id) as is_blocked
        FROM events_members em
        JOIN users u ON em.user_id = u.user_id
        WHERE em.event_id = ?
      `;

      const queryParams = [userId || 0, userId || 0, eventId];

      switch (type) {
        case "going":
          memberQuery += " AND em.is_going = '1'";
          break;
        case "interested":
          memberQuery += " AND em.is_interested = '1'";
          break;
        case "invited":
          memberQuery += " AND em.is_invited = '1'";
          break;
        case "all":
        default:
          memberQuery +=
            " AND (em.is_going = '1' OR em.is_interested = '1' OR em.is_invited = '1')";
          break;
      }

      // Add pagination
      memberQuery += ` ORDER BY em.user_id DESC LIMIT ? OFFSET ?`;
      queryParams.push(parseInt(limit), parseInt(offset));

      const [members] = await pool.query(memberQuery, queryParams);

      // Get total count
      let countQuery =
        "SELECT COUNT(*) as total FROM events_members WHERE event_id = ?";
      const countParams = [eventId];

      switch (type) {
        case "going":
          countQuery += " AND is_going = '1'";
          break;
        case "interested":
          countQuery += " AND is_interested = '1'";
          break;
        case "invited":
          countQuery += " AND is_invited = '1'";
          break;
      }

      const [[countResult]] = await pool.query(countQuery, countParams);

      // Process member pictures
      const processedMembers = await Promise.all(
        members.map(async (member) => {
          if (member.user_picture) {
            try {
              member.user_picture_url = await storageManager.getPublicUrl(
                "local",
                member.user_picture,
              );
            } catch (error) {
              member.user_picture_url = null;
            }
          }
          return member;
        }),
      );

      res.json({
        success: true,
        data: processedMembers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.total,
          totalPages: Math.ceil(countResult.total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 7. INVITE USER TO EVENT
  static async inviteToEvent(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { eventId, userId: inviteeId } = req.params;
      const inviterId = EventsController.getCurrentUserId(req);

      if (!inviterId) {
        throw new UnauthorizedEventError("Authentication required");
      }

      // Check if inviter is admin or going/interested
      const isAdmin = await EventsController.isUserAdmin(eventId, inviterId);
      const isMember = await EventsController.isUserMember(eventId, inviterId);

      if (!isAdmin && !isMember) {
        throw new UnauthorizedEventError(
          "Only event members can invite others",
        );
      }

      // Check if invitee exists
      const [invitee] = await connection.query(
        "SELECT user_id FROM users WHERE user_id = ?",
        [inviteeId],
      );

      if (invitee.length === 0) {
        throw new ValidationEventError("User not found");
      }

      // Check if already invited/going/interested
      const [existing] = await connection.query(
        `SELECT 1 FROM events_members 
         WHERE event_id = ? AND user_id = ? 
         AND (is_invited = '1' OR is_going = '1' OR is_interested = '1')`,
        [eventId, inviteeId],
      );

      if (existing.length > 0) {
        throw new ValidationEventError("User is already invited or a member");
      }

      // Add invitation
      await connection.query(
        `INSERT INTO events_members (event_id, user_id, is_invited) 
         VALUES (?, ?, '1')`,
        [eventId, inviteeId],
      );

      // Update invited count
      await connection.query(
        "UPDATE events SET event_invited = event_invited + 1 WHERE event_id = ?",
        [eventId],
      );

      await connection.commit();

      // Log activity
      await logActivity(
        inviterId,
        "event_invite",
        `Invited user ${inviteeId} to event`,
        eventId,
        "event",
      );

      // TODO: Send notification to invitee

      res.json({
        success: true,
        message: "User invited successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 8. RESPOND TO INVITATION
  static async respondToInvitation(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { eventId } = req.params;
      const userId = EventsController.getCurrentUserId(req);
      const { response } = req.body; // 'going', 'interested', 'decline'

      if (!userId) {
        throw new UnauthorizedEventError("Authentication required");
      }

      if (!["going", "interested", "decline"].includes(response)) {
        throw new ValidationEventError("Invalid response type");
      }

      // Check if user is invited
      const [invitation] = await connection.query(
        `SELECT is_invited, is_going, is_interested 
         FROM events_members 
         WHERE event_id = ? AND user_id = ?`,
        [eventId, userId],
      );

      if (invitation.length === 0 || invitation[0].is_invited !== "1") {
        throw new ValidationEventError("You are not invited to this event");
      }

      // Handle response
      let updateQuery = "";
      let updateCounts = {};

      switch (response) {
        case "going":
          updateQuery =
            "SET is_invited = '0', is_going = '1', is_interested = '0'";
          updateCounts = { invited: -1, going: 1, interested: 0 };
          break;
        case "interested":
          updateQuery =
            "SET is_invited = '0', is_going = '0', is_interested = '1'";
          updateCounts = { invited: -1, going: 0, interested: 1 };
          break;
        case "decline":
          updateQuery =
            "SET is_invited = '0', is_going = '0', is_interested = '0'";
          updateCounts = { invited: -1, going: 0, interested: 0 };
          break;
      }

      // Update member status
      await connection.query(
        `UPDATE events_members ${updateQuery} 
         WHERE event_id = ? AND user_id = ?`,
        [eventId, userId],
      );

      // Update event counts
      if (updateCounts.invited !== 0) {
        await connection.query(
          `UPDATE events SET event_invited = event_invited + ? WHERE event_id = ?`,
          [updateCounts.invited, eventId],
        );
      }

      if (updateCounts.going !== 0) {
        await connection.query(
          `UPDATE events SET event_going = event_going + ? WHERE event_id = ?`,
          [updateCounts.going, eventId],
        );
      }

      if (updateCounts.interested !== 0) {
        await connection.query(
          `UPDATE events SET event_interested = event_interested + ? WHERE event_id = ?`,
          [updateCounts.interested, eventId],
        );
      }

      await connection.commit();

      // Log activity
      await logActivity(
        userId,
        "event_response",
        `Responded to event invitation with: ${response}`,
        eventId,
        "event",
      );

      res.json({
        success: true,
        message: `Invitation ${response} successfully`,
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 9. MARK AS INTERESTED
  static async markInterested(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { eventId } = req.params;
      const userId = EventsController.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedEventError("Authentication required");
      }

      // Check event privacy
      const [event] = await connection.query(
        "SELECT event_privacy FROM events WHERE event_id = ?",
        [eventId],
      );

      if (event.length === 0) {
        throw new EventNotFoundError();
      }

      // For secret events, need to be invited
      if (event[0].event_privacy === "secret") {
        const isInvited = await EventsController.isUserInvited(eventId, userId);
        if (!isInvited) {
          throw new UnauthorizedEventError(
            "You need an invitation to join this event",
          );
        }
      }

      // Check current status
      const [current] = await connection.query(
        `SELECT is_going, is_interested 
         FROM events_members 
         WHERE event_id = ? AND user_id = ?`,
        [eventId, userId],
      );

      if (current.length > 0) {
        // Already marked as interested
        if (current[0].is_interested === "1") {
          throw new ValidationEventError("You're already marked as interested");
        }

        // Update from going to interested
        if (current[0].is_going === "1") {
          await connection.query(
            `UPDATE events_members 
             SET is_going = '0', is_interested = '1' 
             WHERE event_id = ? AND user_id = ?`,
            [eventId, userId],
          );

          // Update counts
          await connection.query(
            `UPDATE events 
             SET event_going = event_going - 1, event_interested = event_interested + 1 
             WHERE event_id = ?`,
            [eventId],
          );
        } else {
          // Mark as interested
          await connection.query(
            `UPDATE events_members 
             SET is_interested = '1' 
             WHERE event_id = ? AND user_id = ?`,
            [eventId, userId],
          );

          await connection.query(
            `UPDATE events 
             SET event_interested = event_interested + 1 
             WHERE event_id = ?`,
            [eventId],
          );
        }
      } else {
        // New interested member
        await connection.query(
          `INSERT INTO events_members (event_id, user_id, is_interested) 
           VALUES (?, ?, '1')`,
          [eventId, userId],
        );

        await connection.query(
          `UPDATE events 
           SET event_interested = event_interested + 1 
           WHERE event_id = ?`,
          [eventId],
        );
      }

      await connection.commit();

      // Log activity
      await logActivity(
        userId,
        "event_interested",
        `Marked as interested in event`,
        eventId,
        "event",
      );

      res.json({
        success: true,
        message: "Marked as interested successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 10. MARK AS GOING
  static async markGoing(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { eventId } = req.params;
      const userId = EventsController.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedEventError("Authentication required");
      }

      // Check event privacy
      const [event] = await connection.query(
        "SELECT event_privacy FROM events WHERE event_id = ?",
        [eventId],
      );

      if (event.length === 0) {
        throw new EventNotFoundError();
      }

      // For secret events, need to be invited
      if (event[0].event_privacy === "secret") {
        const isInvited = await EventsController.isUserInvited(eventId, userId);
        if (!isInvited) {
          throw new UnauthorizedEventError(
            "You need an invitation to join this event",
          );
        }
      }

      // Check current status
      const [current] = await connection.query(
        `SELECT is_going, is_interested 
         FROM events_members 
         WHERE event_id = ? AND user_id = ?`,
        [eventId, userId],
      );

      if (current.length > 0) {
        // Already marked as going
        if (current[0].is_going === "1") {
          throw new ValidationEventError("You're already marked as going");
        }

        // Update from interested to going
        if (current[0].is_interested === "1") {
          await connection.query(
            `UPDATE events_members 
             SET is_interested = '0', is_going = '1' 
             WHERE event_id = ? AND user_id = ?`,
            [eventId, userId],
          );

          // Update counts
          await connection.query(
            `UPDATE events 
             SET event_interested = event_interested - 1, event_going = event_going + 1 
             WHERE event_id = ?`,
            [eventId],
          );
        } else {
          // Mark as going
          await connection.query(
            `UPDATE events_members 
             SET is_going = '1' 
             WHERE event_id = ? AND user_id = ?`,
            [eventId, userId],
          );

          await connection.query(
            `UPDATE events 
             SET event_going = event_going + 1 
             WHERE event_id = ?`,
            [eventId],
          );
        }
      } else {
        // New going member
        await connection.query(
          `INSERT INTO events_members (event_id, user_id, is_going) 
           VALUES (?, ?, '1')`,
          [eventId, userId],
        );

        await connection.query(
          `UPDATE events 
           SET event_going = event_going + 1 
           WHERE event_id = ?`,
          [eventId],
        );
      }

      await connection.commit();

      // Log activity
      await logActivity(
        userId,
        "event_going",
        `Marked as going to event`,
        eventId,
        "event",
      );

      res.json({
        success: true,
        message: "Marked as going successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 11. CREATE POST IN EVENT
  // ============================================================
  // REPLACE the entire createPost method in eventsController.js
  // (method #11, around line 1440-1490)
  // ============================================================

  // 11. CREATE POST IN EVENT
  static async createPost(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { eventId } = req.params;
      const userId = EventsController.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedEventError("Authentication required");
      }

      // Check event access
      const canAccess = await EventsController.checkEventPrivacy(
        eventId,
        userId,
      );
      if (!canAccess) {
        throw new UnauthorizedEventError("You don't have access to this event");
      }

      // Check if post approval is required
      const [event] = await connection.query(
        "SELECT event_publish_approval_enabled FROM events WHERE event_id = ?",
        [eventId],
      );

      if (event.length === 0) {
        throw new EventNotFoundError();
      }

      const needsApproval = event[0].event_publish_approval_enabled === "1";
      const isAdmin = await EventsController.isUserAdmin(eventId, userId);

      // ─── Parse body fields ────────────────────────────────────────────────
      const {
        text,
        privacy = "public",
        location,
        feeling_action,
        feeling_value,
        colored_pattern,
        link,
        post_type = "text",

        // Article
        article_title,
        article_content,
        article_category_id,
        article_tags,

        // Poll
        poll_options,
        poll_end_date,

        // Job
        job_title,
        job_category_id,
        job_location,
        job_salary_minimum,
        job_salary_maximum,
        job_pay_salary_per,
        job_type,
        job_available = "1",

        // Product
        product_name,
        product_price,
        product_quantity = 1,
        product_category_id,
        product_status = "new",
        product_location,
        product_is_digital = "0",
        product_download_url,

        // Funding
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

      // ─── Build files object matching PostService expectations ─────────────
      const files = {
        photos: req.files?.photos || [],
        videos: req.files?.videos || [],
        files: req.files?.files || [],
      };

      switch (post_type) {
        case "article":
          files.articleData = {
            title: article_title,
            text: article_content,
            category_id: article_category_id,
            tags: article_tags
              ? article_tags.split(",").map((t) => t.trim())
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
          files.liveData = {};
          files.thumbnail = req.files?.thumbnail || [];
          break;

        case "media":
          files.media = {
            source_url: link || req.body.media_url,
            source_provider: req.body.media_provider || "unknown",
            source_type: req.body.media_type || "video",
            source_title: req.body.media_title,
          };
          break;

        case "link":
          // link is passed directly below
          break;
      }

      // ─── Call PostService with correct signature ───────────────────────────
      const result = await PostService.createPost({
        userId,
        userType: "user",
        text: text || (post_type === "poll" ? req.body.poll_question : null),
        privacy: "public", // event posts always public to members
        location,
        feeling_action,
        feeling_value,
        colored_pattern,
        postType: post_type,
        files,
        link: post_type === "link" ? link : null,
        inEvent: true,
        eventId,
        eventApproved: isAdmin || !needsApproval,
        inGroup: false,
        inWall: false,
        isAnonymous: is_anonymous === "1",
        forAdult: for_adult === "1",
        disableComments: disable_comments === "1",
        isPaid: is_paid === "1",
        postPrice: parseFloat(post_price) || 0,
        paidText: paid_text || null,
        forSubscriptions: for_subscriptions === "1",
        tipsEnabled: tips_enabled === "1",
      });

      await connection.commit();

      // Log activity
      await logActivity(
        userId,
        "event_post_create",
        `Created post in event`,
        eventId,
        "event",
      );

      res.status(201).json({
        success: true,
        message:
          needsApproval && !isAdmin
            ? "Post submitted for approval"
            : "Post created successfully",
        data: result,
        needs_approval: needsApproval && !isAdmin,
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 12. GET EVENT POSTS
  static async getEventPosts(req, res, next) {
    try {
      const { eventId } = req.params;
      const userId = EventsController.getCurrentUserId(req);
      const {
        page = 1,
        limit = 20,
        type = "all", // 'all', 'pending', 'approved'
      } = req.query;

      const offset = (page - 1) * limit;

      // Check event access
      const canAccess = await EventsController.checkEventPrivacy(
        eventId,
        userId,
      );
      if (!canAccess) {
        throw new UnauthorizedEventError("You don't have access to this event");
      }

      const isAdmin = userId
        ? await EventsController.isUserAdmin(eventId, userId)
        : false;

      let query = `
        SELECT p.*, 
               u.user_name, u.user_firstname, u.user_lastname, u.user_picture,
               u.user_verified,
               (SELECT COUNT(*) FROM posts_reactions pr WHERE pr.post_id = p.post_id) as total_reactions,
               (SELECT COUNT(*) FROM posts_comments pc WHERE pc.node_id = p.post_id AND pc.node_type = 'post') as total_comments,
               (SELECT COUNT(*) FROM posts_saved ps WHERE ps.post_id = p.post_id AND ps.user_id = ?) as is_saved,
               (SELECT reaction FROM posts_reactions pr2 WHERE pr2.post_id = p.post_id AND pr2.user_id = ?) as user_reaction
        FROM posts p
        LEFT JOIN users u ON p.user_id = u.user_id
        WHERE p.in_event = '1' AND p.event_id = ?
      `;

      const queryParams = [userId || 0, userId || 0, eventId];

      // Filter by post status
      if (type === "pending") {
        if (!isAdmin) {
          throw new UnauthorizedEventError(
            "Only admins can view pending posts",
          );
        }
        query += " AND p.event_approved = '0'";
      } else if (type === "approved") {
        query += " AND p.event_approved = '1'";
      } else {
        // Show approved posts to everyone, pending only to admins
        if (!isAdmin) {
          query += " AND p.event_approved = '1'";
        }
      }

      query += " ORDER BY p.time DESC LIMIT ? OFFSET ?";
      queryParams.push(parseInt(limit), parseInt(offset));

      const [posts] = await pool.query(query, queryParams);

      // Get total count
      let countQuery =
        "SELECT COUNT(*) as total FROM posts WHERE in_event = '1' AND event_id = ?";
      const countParams = [eventId];

      if (type === "pending") {
        countQuery += " AND event_approved = '0'";
      } else if (type === "approved") {
        countQuery += " AND event_approved = '1'";
      } else if (!isAdmin) {
        countQuery += " AND event_approved = '1'";
      }

      const [[countResult]] = await pool.query(countQuery, countParams);

      // Process posts (get media, format dates, etc.)
      const processedPosts = await Promise.all(
        posts.map(async (post) => {
          // Get post media
          const [photos] = await pool.query(
            "SELECT * FROM posts_photos WHERE post_id = ?",
            [post.post_id],
          );

          const [videos] = await pool.query(
            "SELECT * FROM posts_videos WHERE post_id = ?",
            [post.post_id],
          );

          const [files] = await pool.query(
            "SELECT * FROM posts_files WHERE post_id = ?",
            [post.post_id],
          );

          const [audios] = await pool.query(
            "SELECT * FROM posts_audios WHERE post_id = ?",
            [post.post_id],
          );

          // Process user picture
          if (post.user_picture) {
            try {
              post.user_picture_url = await storageManager.getPublicUrl(
                "local",
                post.user_picture,
              );
            } catch (error) {
              post.user_picture_url = null;
            }
          }

          // Process post photos
          const processedPhotos = await Promise.all(
            photos.map(async (photo) => {
              try {
                photo.source_url = await storageManager.getPublicUrl(
                  photo.storage_type || "local",
                  photo.source,
                  photo.storage_data,
                );
              } catch (error) {
                photo.source_url = null;
              }
              return photo;
            }),
          );

          return {
            ...post,
            photos: processedPhotos,
            videos,
            files,
            audios,
          };
        }),
      );

      res.json({
        success: true,
        data: processedPosts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.total,
          totalPages: Math.ceil(countResult.total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 13. GET EVENT CATEGORIES
  static async getEventCategories(req, res, next) {
    try {
      const { parent_id } = req.query;

      let query = `
        SELECT c.*
        FROM events_categories c
        WHERE c.category_parent_id = ?
        ORDER BY c.category_order ASC, c.category_name ASC
      `;

      const [categories] = await pool.query(query, [parent_id || 0]);
      console.log("categories", categories);
      res.json({
        success: true,
        data: categories,
      });
    } catch (error) {
      next(error);
    }
  }

  // 14. SEARCH EVENTS
  static async searchEvents(req, res, next) {
    try {
      const userId = EventsController.getCurrentUserId(req);
      const {
        q,
        category,
        location,
        date_from,
        date_to,
        page = 1,
        limit = 20,
      } = req.query;

      const offset = (page - 1) * limit;

      if (!q && !category && !location && !date_from && !date_to) {
        throw new ValidationEventError(
          "Please provide at least one search criteria",
        );
      }

      let query = `
        SELECT e.*, 
               ec.category_name,
               COUNT(DISTINCT em_going.user_id) as going_count,
               COUNT(DISTINCT em_interested.user_id) as interested_count
        FROM events e
        LEFT JOIN events_categories ec ON e.event_category = ec.category_id
        LEFT JOIN events_members em_going ON e.event_id = em_going.event_id AND em_going.is_going = '1'
        LEFT JOIN events_members em_interested ON e.event_id = em_interested.event_id AND em_interested.is_interested = '1'
        WHERE 1=1
      `;

      const queryParams = [];

      // Apply privacy filters
      if (userId) {
        query += ` AND (
          e.event_privacy = 'public' 
          OR e.event_admin = ?
          OR EXISTS (
            SELECT 1 FROM events_members em 
            WHERE em.event_id = e.event_id 
            AND em.user_id = ? 
            AND (em.is_going = '1' OR em.is_interested = '1')
          )
        )`;
        queryParams.push(userId, userId);
      } else {
        query += ` AND e.event_privacy = 'public'`;
      }

      // Apply search criteria
      if (q) {
        query += ` AND (
          e.event_title LIKE ? 
          OR e.event_description LIKE ? 
          OR e.event_location LIKE ?
        )`;
        const searchTerm = `%${q}%`;
        queryParams.push(searchTerm, searchTerm, searchTerm);
      }

      if (category) {
        query += ` AND e.event_category = ?`;
        queryParams.push(category);
      }

      if (location) {
        query += ` AND e.event_location LIKE ?`;
        queryParams.push(`%${location}%`);
      }

      if (date_from) {
        query += ` AND e.event_start_date >= ?`;
        queryParams.push(date_from);
      }

      if (date_to) {
        query += ` AND e.event_end_date <= ?`;
        queryParams.push(date_to);
      }

      query += ` GROUP BY e.event_id ORDER BY e.event_date DESC LIMIT ? OFFSET ?`;
      queryParams.push(parseInt(limit), parseInt(offset));

      const [events] = await pool.query(query, queryParams);

      // Get total count
      let countQuery = "SELECT COUNT(*) as total FROM events e WHERE 1=1";
      const countParams = [];

      if (userId) {
        countQuery += ` AND (
          e.event_privacy = 'public' 
          OR e.event_admin = ?
          OR EXISTS (
            SELECT 1 FROM events_members em 
            WHERE em.event_id = e.event_id 
            AND em.user_id = ? 
            AND (em.is_going = '1' OR em.is_interested = '1')
          )
        )`;
        countParams.push(userId, userId);
      } else {
        countQuery += ` AND e.event_privacy = 'public'`;
      }

      if (q) {
        countQuery += ` AND (
          e.event_title LIKE ? 
          OR e.event_description LIKE ? 
          OR e.event_location LIKE ?
        )`;
        const searchTerm = `%${q}%`;
        countParams.push(searchTerm, searchTerm, searchTerm);
      }

      if (category) {
        countQuery += ` AND e.event_category = ?`;
        countParams.push(category);
      }

      if (location) {
        countQuery += ` AND e.event_location LIKE ?`;
        countParams.push(`%${location}%`);
      }

      if (date_from) {
        countQuery += ` AND e.event_start_date >= ?`;
        countParams.push(date_from);
      }

      if (date_to) {
        countQuery += ` AND e.event_end_date <= ?`;
        countParams.push(date_to);
      }

      const [[countResult]] = await pool.query(countQuery, countParams);

      // Process event covers
      const processedEvents = await Promise.all(
        events.map(async (event) => {
          if (event.event_cover) {
            try {
              event.event_cover_url = await storageManager.getPublicUrl(
                event.event_cover_storage_type || "local",
                event.event_cover,
                event.event_cover_storage_data,
              );
            } catch (error) {
              event.event_cover_url = null;
            }
          }
          return event;
        }),
      );

      res.json({
        success: true,
        data: processedEvents,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.total,
          totalPages: Math.ceil(countResult.total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 15. GET USER EVENTS
  static async getUserEvents(req, res, next) {
    try {
      const userId =
        req.params.userId || EventsController.getCurrentUserId(req);
      const currentUserId = EventsController.getCurrentUserId(req);
      const {
        type = "all", // 'created', 'going', 'interested', 'invited', 'all'
        page = 1,
        limit = 20,
      } = req.query;

      const offset = (page - 1) * limit;

      if (!userId) {
        throw new ValidationEventError("User ID is required");
      }

      let query = `
        SELECT e.*, 
               ec.category_name,
               em.is_going, em.is_interested, em.is_invited,
               COUNT(DISTINCT em2.user_id) as going_count,
               COUNT(DISTINCT em3.user_id) as interested_count
        FROM events e
        LEFT JOIN events_categories ec ON e.event_category = ec.category_id
        LEFT JOIN events_members em ON e.event_id = em.event_id AND em.user_id = ?
        LEFT JOIN events_members em2 ON e.event_id = em2.event_id AND em2.is_going = '1'
        LEFT JOIN events_members em3 ON e.event_id = em3.event_id AND em3.is_interested = '1'
        WHERE 1=1
      `;

      const queryParams = [userId];

      // Filter by relationship type
      switch (type) {
        case "created":
          query += ` AND e.event_admin = ?`;
          queryParams.push(userId);
          break;
        case "going":
          query += ` AND em.is_going = '1'`;
          break;
        case "interested":
          query += ` AND em.is_interested = '1'`;
          break;
        case "invited":
          query += ` AND em.is_invited = '1'`;
          break;
        case "all":
        default:
          query += ` AND (
            e.event_admin = ? 
            OR em.is_going = '1' 
            OR em.is_interested = '1' 
            OR em.is_invited = '1'
          )`;
          queryParams.push(userId);
          break;
      }

      // Apply privacy filters for non-self views
      if (parseInt(userId) !== parseInt(currentUserId)) {
        query += ` AND (
          e.event_privacy = 'public' 
          OR EXISTS (
            SELECT 1 FROM events_members em4 
            WHERE em4.event_id = e.event_id 
            AND em4.user_id = ? 
            AND (em4.is_going = '1' OR em4.is_interested = '1')
          )
        )`;
        queryParams.push(currentUserId || 0);
      }

      query += ` GROUP BY e.event_id ORDER BY e.event_date DESC LIMIT ? OFFSET ?`;
      queryParams.push(parseInt(limit), parseInt(offset));

      const [events] = await pool.query(query, queryParams);

      // Get total count
      let countQuery = `
        SELECT COUNT(*) as total 
        FROM events e
        LEFT JOIN events_members em ON e.event_id = em.event_id AND em.user_id = ?
        WHERE 1=1
      `;

      const countParams = [userId];

      switch (type) {
        case "created":
          countQuery += ` AND e.event_admin = ?`;
          countParams.push(userId);
          break;
        case "going":
          countQuery += ` AND em.is_going = '1'`;
          break;
        case "interested":
          countQuery += ` AND em.is_interested = '1'`;
          break;
        case "invited":
          countQuery += ` AND em.is_invited = '1'`;
          break;
        case "all":
        default:
          countQuery += ` AND (
            e.event_admin = ? 
            OR em.is_going = '1' 
            OR em.is_interested = '1' 
            OR em.is_invited = '1'
          )`;
          countParams.push(userId);
          break;
      }

      if (parseInt(userId) !== parseInt(currentUserId)) {
        countQuery += ` AND (
          e.event_privacy = 'public' 
          OR EXISTS (
            SELECT 1 FROM events_members em4 
            WHERE em4.event_id = e.event_id 
            AND em4.user_id = ? 
            AND (em4.is_going = '1' OR em4.is_interested = '1')
          )
        )`;
        countParams.push(currentUserId || 0);
      }

      const [[countResult]] = await pool.query(countQuery, countParams);

      // Process event covers
      const processedEvents = await Promise.all(
        events.map(async (event) => {
          if (event.event_cover) {
            try {
              event.event_cover_url = await storageManager.getPublicUrl(
                event.event_cover_storage_type || "local",
                event.event_cover,
                event.event_cover_storage_data,
              );
            } catch (error) {
              event.event_cover_url = null;
            }
          }
          return event;
        }),
      );

      res.json({
        success: true,
        data: processedEvents,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.total,
          totalPages: Math.ceil(countResult.total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 16. GET UPCOMING EVENTS
  static async getUpcomingEvents(req, res, next) {
    try {
      const userId = EventsController.getCurrentUserId(req);
      const { page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      let query = `
        SELECT e.*, 
               ec.category_name,
               COUNT(DISTINCT em_going.user_id) as going_count,
               COUNT(DISTINCT em_interested.user_id) as interested_count,
               DATEDIFF(e.event_start_date, NOW()) as days_until
        FROM events e
        LEFT JOIN events_categories ec ON e.event_category = ec.category_id
        LEFT JOIN events_members em_going ON e.event_id = em_going.event_id AND em_going.is_going = '1'
        LEFT JOIN events_members em_interested ON e.event_id = em_interested.event_id AND em_interested.is_interested = '1'
        WHERE e.event_start_date > NOW()
      `;

      const queryParams = [];

      // Apply privacy filters
      if (userId) {
        query += ` AND (
          e.event_privacy = 'public' 
          OR e.event_admin = ?
          OR EXISTS (
            SELECT 1 FROM events_members em 
            WHERE em.event_id = e.event_id 
            AND em.user_id = ? 
            AND (em.is_going = '1' OR em.is_interested = '1')
          )
        )`;
        queryParams.push(userId, userId);
      } else {
        query += ` AND e.event_privacy = 'public'`;
      }

      query += ` GROUP BY e.event_id ORDER BY e.event_start_date ASC LIMIT ? OFFSET ?`;
      queryParams.push(parseInt(limit), parseInt(offset));

      const [events] = await pool.query(query, queryParams);

      // Get total count
      const [countResult] = await pool.query(
        `SELECT COUNT(*) as total FROM events e WHERE e.event_start_date > NOW() ${
          userId
            ? `AND (e.event_privacy = 'public' OR e.event_admin = ?)`
            : `AND e.event_privacy = 'public'`
        }`,
        userId ? [userId] : [],
      );

      // Process event covers
      const processedEvents = await Promise.all(
        events.map(async (event) => {
          if (event.event_cover) {
            try {
              event.event_cover_url = await storageManager.getPublicUrl(
                event.event_cover_storage_type || "local",
                event.event_cover,
                event.event_cover_storage_data,
              );
            } catch (error) {
              event.event_cover_url = null;
            }
          }
          return event;
        }),
      );

      res.json({
        success: true,
        data: processedEvents,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult[0].total,
          totalPages: Math.ceil(countResult[0].total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 17. REPORT EVENT
  static async reportEvent(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { eventId } = req.params;
      const userId = EventsController.getCurrentUserId(req);
      const { category_id, reason } = req.body;

      if (!userId) {
        throw new UnauthorizedEventError("Authentication required");
      }

      if (!category_id || !reason?.trim()) {
        throw new ValidationEventError("Category and reason are required");
      }

      // Check if event exists
      const [events] = await connection.query(
        "SELECT 1 FROM events WHERE event_id = ?",
        [eventId],
      );

      if (events.length === 0) {
        throw new EventNotFoundError();
      }

      // Check if already reported
      const [existing] = await connection.query(
        `SELECT 1 FROM reports 
         WHERE user_id = ? AND node_id = ? AND node_type = 'event'`,
        [userId, eventId],
      );

      if (existing.length > 0) {
        throw new ValidationEventError("You have already reported this event");
      }

      // Create report
      await connection.query(
        `INSERT INTO reports (user_id, node_id, node_type, category_id, reason, time) 
         VALUES (?, ?, 'event', ?, ?, NOW())`,
        [userId, eventId, category_id, reason],
      );

      await connection.commit();

      // Log activity
      await logActivity(
        userId,
        "event_report",
        `Reported event ${eventId}`,
        eventId,
        "event",
      );

      res.json({
        success: true,
        message: "Event reported successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 18. GET REPORT CATEGORIES
  static async getReportCategories(req, res, next) {
    try {
      const { parent_id } = req.query;

      const [categories] = await pool.query(
        `SELECT * FROM reports_categories 
         WHERE category_parent_id = ? 
         ORDER BY category_order ASC`,
        [parent_id || 0],
      );

      res.json({
        success: true,
        data: categories,
      });
    } catch (error) {
      next(error);
    }
  }

  // 19. GET EVENT STATISTICS
  static async getEventStats(req, res, next) {
    try {
      const { eventId } = req.params;
      const userId = EventsController.getCurrentUserId(req);

      // Check if user is admin
      const isAdmin = await EventsController.isUserAdmin(eventId, userId);
      if (!isAdmin) {
        throw new UnauthorizedEventError(
          "Only event admins can view statistics",
        );
      }

      // Get basic counts
      const [[goingCount]] = await pool.query(
        "SELECT COUNT(*) as count FROM events_members WHERE event_id = ? AND is_going = '1'",
        [eventId],
      );

      const [[interestedCount]] = await pool.query(
        "SELECT COUNT(*) as count FROM events_members WHERE event_id = ? AND is_interested = '1'",
        [eventId],
      );

      const [[invitedCount]] = await pool.query(
        "SELECT COUNT(*) as count FROM events_members WHERE event_id = ? AND is_invited = '1'",
        [eventId],
      );

      const [[postCount]] = await pool.query(
        "SELECT COUNT(*) as count FROM posts WHERE event_id = ?",
        [eventId],
      );

      const [[pendingPostCount]] = await pool.query(
        "SELECT COUNT(*) as count FROM posts WHERE event_id = ? AND event_approved = '0'",
        [eventId],
      );

      // Get member growth over time (last 30 days)
      const [growthData] = await pool.query(
        `SELECT 
           DATE(em.created_at) as date,
           SUM(CASE WHEN em.is_going = '1' THEN 1 ELSE 0 END) as going,
           SUM(CASE WHEN em.is_interested = '1' THEN 1 ELSE 0 END) as interested
         FROM events_members em
         WHERE em.event_id = ? AND em.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         GROUP BY DATE(em.created_at)
         ORDER BY date ASC`,
        [eventId],
      );

      res.json({
        success: true,
        data: {
          counts: {
            going: goingCount.count,
            interested: interestedCount.count,
            invited: invitedCount.count,
            posts: postCount.count,
            pending_posts: pendingPostCount.count,
          },
          growth: growthData,
          last_updated: new Date(),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 20. REQUEST VERIFICATION
  static async requestVerification(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { eventId } = req.params;
      const userId = EventsController.getCurrentUserId(req);
      const { photo, passport, business_website, business_address, message } =
        req.body;

      if (!userId) {
        throw new UnauthorizedEventError("Authentication required");
      }

      // Check if user is admin
      const isAdmin = await EventsController.isUserAdmin(eventId, userId);
      if (!isAdmin) {
        throw new UnauthorizedEventError(
          "Only event admins can request verification",
        );
      }

      // Check if already has verification request
      const [existing] = await connection.query(
        `SELECT 1 FROM verification_requests 
         WHERE node_id = ? AND node_type = 'event' AND status = 0`,
        [eventId],
      );

      if (existing.length > 0) {
        throw new ValidationEventError(
          "You already have a pending verification request",
        );
      }

      // Handle file uploads if provided
      let photoResult = null;
      let passportResult = null;

      if (photo) {
        photoResult = await handleBase64Upload(
          photo,
          `event-verification-${eventId}-photo.jpg`,
          "verifications",
        );
      }

      if (passport) {
        passportResult = await handleBase64Upload(
          passport,
          `event-verification-${eventId}-passport.jpg`,
          "verifications",
        );
      }

      // Create verification request
      await connection.query(
        `INSERT INTO verification_requests 
         (node_id, node_type, photo, passport, business_website, business_address, message, time, status) 
         VALUES (?, 'event', ?, ?, ?, ?, ?, NOW(), 0)`,
        [
          eventId,
          photoResult ? photoResult.path : null,
          passportResult ? passportResult.path : null,
          business_website || null,
          business_address || null,
          message || null,
        ],
      );

      await connection.commit();

      // Log activity
      await logActivity(
        userId,
        "event_verification_request",
        `Requested verification for event`,
        eventId,
        "event",
      );

      res.json({
        success: true,
        message: "Verification request submitted successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 21. DELETE EVENT POST
  static async deletePost(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { eventId, postId } = req.params;
      const userId = EventsController.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedEventError("Authentication required");
      }

      // Check post exists and belongs to event
      const [posts] = await connection.query(
        "SELECT * FROM posts WHERE post_id = ? AND event_id = ?",
        [postId, eventId],
      );

      if (posts.length === 0) {
        throw new ValidationEventError("Post not found in this event");
      }

      const post = posts[0];

      // Check if user can delete (admin or post owner)
      const isAdmin = await EventsController.isUserAdmin(eventId, userId);
      const isPostOwner = post.user_id === userId;

      if (!isAdmin && !isPostOwner) {
        throw new UnauthorizedEventError("You can only delete your own posts");
      }

      // Delete post using PostService
      await PostService.deletePost(postId, connection);

      await connection.commit();

      // Log activity
      await logActivity(
        userId,
        "event_post_delete",
        `Deleted post ${postId} from event`,
        eventId,
        "event",
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

  // 22. APPROVE PENDING POST
  static async approvePost(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { eventId, postId } = req.params;
      const userId = EventsController.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedEventError("Authentication required");
      }

      // Check if user is admin
      const isAdmin = await EventsController.isUserAdmin(eventId, userId);
      if (!isAdmin) {
        throw new UnauthorizedEventError("Only event admins can approve posts");
      }

      // Check post exists and needs approval
      const [posts] = await connection.query(
        "SELECT * FROM posts WHERE post_id = ? AND event_id = ? AND event_approved = '0'",
        [postId, eventId],
      );

      if (posts.length === 0) {
        throw new ValidationEventError("Post not found or already approved");
      }

      // Approve post
      await connection.query(
        "UPDATE posts SET event_approved = '1' WHERE post_id = ?",
        [postId],
      );

      await connection.commit();

      // Log activity
      await logActivity(
        userId,
        "event_post_approve",
        `Approved post ${postId} in event`,
        eventId,
        "event",
      );

      // TODO: Send notification to post owner

      res.json({
        success: true,
        message: "Post approved successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 23. REJECT PENDING POST
  static async rejectPost(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { eventId, postId } = req.params;
      const userId = EventsController.getCurrentUserId(req);
      const { reason } = req.body; // Optional rejection reason

      if (!userId) {
        throw new UnauthorizedEventError("Authentication required");
      }

      // Check if user is admin
      const isAdmin = await EventsController.isUserAdmin(eventId, userId);
      if (!isAdmin) {
        throw new UnauthorizedEventError("Only event admins can reject posts");
      }

      // Check post exists and needs approval
      const [posts] = await connection.query(
        "SELECT * FROM posts WHERE post_id = ? AND event_id = ? AND event_approved = '0'",
        [postId, eventId],
      );

      if (posts.length === 0) {
        throw new ValidationEventError("Post not found or already approved");
      }

      const post = posts[0];

      // Delete post (or mark as rejected)
      await PostService.deletePost(postId, connection);

      await connection.commit();

      // Log activity
      await logActivity(
        userId,
        "event_post_reject",
        `Rejected post ${postId} in event${reason ? `: ${reason}` : ""}`,
        eventId,
        "event",
      );

      // TODO: Send notification to post owner with rejection reason

      res.json({
        success: true,
        message: "Post rejected and removed",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 24. PIN POST IN EVENT
  static async pinPost(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { eventId, postId } = req.params;
      const userId = EventsController.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedEventError("Authentication required");
      }

      // Check if user is admin
      const isAdmin = await EventsController.isUserAdmin(eventId, userId);
      if (!isAdmin) {
        throw new UnauthorizedEventError("Only event admins can pin posts");
      }

      // Check post exists and is approved
      const [posts] = await connection.query(
        "SELECT * FROM posts WHERE post_id = ? AND event_id = ? AND event_approved = '1'",
        [postId, eventId],
      );

      if (posts.length === 0) {
        throw new ValidationEventError("Post not found or not approved");
      }

      // Unpin any currently pinned post
      await connection.query(
        "UPDATE events SET event_pinned_post = NULL WHERE event_id = ?",
        [eventId],
      );

      // Pin new post
      await connection.query(
        "UPDATE events SET event_pinned_post = ? WHERE event_id = ?",
        [postId, eventId],
      );

      await connection.commit();

      // Log activity
      await logActivity(
        userId,
        "event_post_pin",
        `Pinned post ${postId} in event`,
        eventId,
        "event",
      );

      res.json({
        success: true,
        message: "Post pinned successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 25. UNPIN POST IN EVENT
  static async unpinPost(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { eventId } = req.params;
      const userId = EventsController.getCurrentUserId(req);

      if (!userId) {
        throw new UnauthorizedEventError("Authentication required");
      }

      // Check if user is admin
      const isAdmin = await EventsController.isUserAdmin(eventId, userId);
      if (!isAdmin) {
        throw new UnauthorizedEventError("Only event admins can unpin posts");
      }

      // Unpin post
      await connection.query(
        "UPDATE events SET event_pinned_post = NULL WHERE event_id = ?",
        [eventId],
      );

      await connection.commit();

      // Log activity
      await logActivity(
        userId,
        "event_post_unpin",
        `Unpinned post in event`,
        eventId,
        "event",
      );

      res.json({
        success: true,
        message: "Post unpinned successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }
  // 26. REMOVE MEMBER FROM EVENT
  static async removeMember(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { eventId, userId: memberId } = req.params;
      const adminId = EventsController.getCurrentUserId(req);

      if (!adminId) {
        throw new UnauthorizedEventError("Authentication required");
      }

      // Check if user is admin
      const isAdmin = await EventsController.isUserAdmin(eventId, adminId);
      if (!isAdmin) {
        throw new UnauthorizedEventError(
          "Only event admins can remove members",
        );
      }

      // Cannot remove yourself
      if (parseInt(adminId) === parseInt(memberId)) {
        throw new ValidationEventError("Cannot remove yourself from event");
      }

      // Get member status
      const [member] = await connection.query(
        `SELECT is_going, is_interested, is_invited 
       FROM events_members 
       WHERE event_id = ? AND user_id = ?`,
        [eventId, memberId],
      );

      if (member.length === 0) {
        throw new ValidationEventError("User is not a member of this event");
      }

      const memberStatus = member[0];

      // Remove member
      await connection.query(
        "DELETE FROM events_members WHERE event_id = ? AND user_id = ?",
        [eventId, memberId],
      );

      // Update counts
      if (memberStatus.is_going === "1") {
        await connection.query(
          "UPDATE events SET event_going = event_going - 1 WHERE event_id = ?",
          [eventId],
        );
      }

      if (memberStatus.is_interested === "1") {
        await connection.query(
          "UPDATE events SET event_interested = event_interested - 1 WHERE event_id = ?",
          [eventId],
        );
      }

      if (memberStatus.is_invited === "1") {
        await connection.query(
          "UPDATE events SET event_invited = event_invited - 1 WHERE event_id = ?",
          [eventId],
        );
      }

      await connection.commit();

      // Log activity
      await logActivity(
        adminId,
        "event_member_remove",
        `Removed member ${memberId} from event`,
        eventId,
        "event",
      );

      // TODO: Send notification to removed member

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

  // 27. MAKE USER ADMIN
  static async makeAdmin(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { eventId, userId: newAdminId } = req.params;
      const adminId = EventsController.getCurrentUserId(req);

      if (!adminId) {
        throw new UnauthorizedEventError("Authentication required");
      }

      // Check if user is event admin
      const isAdmin = await EventsController.isUserAdmin(eventId, adminId);
      if (!isAdmin) {
        throw new UnauthorizedEventError(
          "Only event admins can add other admins",
        );
      }

      // Cannot make yourself admin (already admin)
      if (parseInt(adminId) === parseInt(newAdminId)) {
        throw new ValidationEventError("You are already an admin");
      }

      // Check if user is a member
      const [member] = await connection.query(
        `SELECT 1 FROM events_members 
       WHERE event_id = ? AND user_id = ? AND is_going = '1'`,
        [eventId, newAdminId],
      );

      if (member.length === 0) {
        throw new ValidationEventError(
          "User must be going to the event to become admin",
        );
      }

      // Check if already admin
      const [existingAdmin] = await connection.query(
        "SELECT 1 FROM events WHERE event_id = ? AND event_admin = ?",
        [eventId, newAdminId],
      );

      if (existingAdmin.length > 0) {
        throw new ValidationEventError("User is already an admin");
      }

      // Make user admin (update event_admin field)
      await connection.query(
        "UPDATE events SET event_admin = ? WHERE event_id = ?",
        [newAdminId, eventId],
      );

      await connection.commit();

      // Log activity
      await logActivity(
        adminId,
        "event_make_admin",
        `Made user ${newAdminId} admin of event`,
        eventId,
        "event",
      );

      // TODO: Send notification to new admin

      res.json({
        success: true,
        message: "User promoted to admin successfully",
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 28. REMOVE ADMIN (Note: This would require changing how admins work since events only have one admin)
  // For multi-admin support, you'd need an events_admins table like pages_admins
  static async removeAdmin(req, res, next) {
    // This method needs events_admins table implementation first
    throw new EventError("Multi-admin support not implemented", 501);
  }

  // 29. GET EVENT ADMINS
  static async getEventAdmins(req, res, next) {
    try {
      const { eventId } = req.params;

      // Currently events only have one admin
      const [event] = await pool.query(
        `SELECT e.event_admin, 
              u.user_id, u.user_name, u.user_firstname, u.user_lastname,
              u.user_picture, u.user_verified
       FROM events e
       JOIN users u ON e.event_admin = u.user_id
       WHERE e.event_id = ?`,
        [eventId],
      );

      if (event.length === 0) {
        throw new EventNotFoundError();
      }

      const admin = event[0];

      // Process admin picture
      if (admin.user_picture) {
        try {
          admin.user_picture_url = await storageManager.getPublicUrl(
            "local",
            admin.user_picture,
          );
        } catch (error) {
          admin.user_picture_url = null;
        }
      }

      res.json({
        success: true,
        data: [admin], // Return as array for consistency
      });
    } catch (error) {
      next(error);
    }
  }
  // 30. GET GOING LIST
  static async getGoingList(req, res, next) {
    try {
      const { eventId } = req.params;
      const userId = EventsController.getCurrentUserId(req);
      const { page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      // Check event access
      const canAccess = await EventsController.checkEventPrivacy(
        eventId,
        userId,
      );
      if (!canAccess) {
        throw new UnauthorizedEventError("You don't have access to this event");
      }

      const [members] = await pool.query(
        `SELECT em.user_id, em.is_going, em.is_interested, em.is_invited,
              u.user_name, u.user_firstname, u.user_lastname,
              u.user_picture, u.user_verified,
              (u.user_id = ?) as is_self
       FROM events_members em
       JOIN users u ON em.user_id = u.user_id
       WHERE em.event_id = ? AND em.is_going = '1'
       ORDER BY em.user_id DESC
       LIMIT ? OFFSET ?`,
        [userId || 0, eventId, parseInt(limit), parseInt(offset)],
      );

      // Get total count
      const [[countResult]] = await pool.query(
        "SELECT COUNT(*) as total FROM events_members WHERE event_id = ? AND is_going = '1'",
        [eventId],
      );

      // Process user pictures
      const processedMembers = await Promise.all(
        members.map(async (member) => {
          if (member.user_picture) {
            try {
              member.user_picture_url = await storageManager.getPublicUrl(
                "local",
                member.user_picture,
              );
            } catch (error) {
              member.user_picture_url = null;
            }
          }
          return member;
        }),
      );

      res.json({
        success: true,
        data: processedMembers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.total,
          totalPages: Math.ceil(countResult.total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 31. GET INTERESTED LIST
  static async getInterestedList(req, res, next) {
    try {
      const { eventId } = req.params;
      const userId = EventsController.getCurrentUserId(req);
      const { page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      // Check event access
      const canAccess = await EventsController.checkEventPrivacy(
        eventId,
        userId,
      );
      if (!canAccess) {
        throw new UnauthorizedEventError("You don't have access to this event");
      }

      const [members] = await pool.query(
        `SELECT em.user_id, em.is_going, em.is_interested, em.is_invited,
              u.user_name, u.user_firstname, u.user_lastname,
              u.user_picture, u.user_verified,
              (u.user_id = ?) as is_self
       FROM events_members em
       JOIN users u ON em.user_id = u.user_id
       WHERE em.event_id = ? AND em.is_interested = '1'
       ORDER BY em.user_id DESC
       LIMIT ? OFFSET ?`,
        [userId || 0, eventId, parseInt(limit), parseInt(offset)],
      );

      // Get total count
      const [[countResult]] = await pool.query(
        "SELECT COUNT(*) as total FROM events_members WHERE event_id = ? AND is_interested = '1'",
        [eventId],
      );

      // Process user pictures
      const processedMembers = await Promise.all(
        members.map(async (member) => {
          if (member.user_picture) {
            try {
              member.user_picture_url = await storageManager.getPublicUrl(
                "local",
                member.user_picture,
              );
            } catch (error) {
              member.user_picture_url = null;
            }
          }
          return member;
        }),
      );

      res.json({
        success: true,
        data: processedMembers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.total,
          totalPages: Math.ceil(countResult.total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 32. GET INVITED LIST
  static async getInvitedList(req, res, next) {
    try {
      const { eventId } = req.params;
      const userId = EventsController.getCurrentUserId(req);
      const { page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      // Check if user is admin or going/interested
      const isAdmin = await EventsController.isUserAdmin(eventId, userId);
      const isMember = await EventsController.isUserMember(eventId, userId);

      if (!isAdmin && !isMember) {
        throw new UnauthorizedEventError(
          "You don't have access to view invited list",
        );
      }

      const [members] = await pool.query(
        `SELECT em.user_id, em.is_going, em.is_interested, em.is_invited,
              u.user_name, u.user_firstname, u.user_lastname,
              u.user_picture, u.user_verified,
              (u.user_id = ?) as is_self
       FROM events_members em
       JOIN users u ON em.user_id = u.user_id
       WHERE em.event_id = ? AND em.is_invited = '1'
       ORDER BY em.user_id DESC
       LIMIT ? OFFSET ?`,
        [userId || 0, eventId, parseInt(limit), parseInt(offset)],
      );

      // Get total count
      const [[countResult]] = await pool.query(
        "SELECT COUNT(*) as total FROM events_members WHERE event_id = ? AND is_invited = '1'",
        [eventId],
      );

      // Process user pictures
      const processedMembers = await Promise.all(
        members.map(async (member) => {
          if (member.user_picture) {
            try {
              member.user_picture_url = await storageManager.getPublicUrl(
                "local",
                member.user_picture,
              );
            } catch (error) {
              member.user_picture_url = null;
            }
          }
          return member;
        }),
      );

      res.json({
        success: true,
        data: processedMembers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.total,
          totalPages: Math.ceil(countResult.total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }
  // 33. GET EVENTS BY CATEGORY
  static async getEventsByCategory(req, res, next) {
    try {
      const { categoryId } = req.params;
      const userId = EventsController.getCurrentUserId(req);
      const { page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      // Check if category exists
      const [categories] = await pool.query(
        "SELECT * FROM events_categories WHERE category_id = ?",
        [categoryId],
      );

      if (categories.length === 0) {
        throw new ValidationEventError("Category not found");
      }

      // Get events in this category
      let query = `
      SELECT e.*, 
             ec.category_name,
             COUNT(DISTINCT em_going.user_id) as going_count,
             COUNT(DISTINCT em_interested.user_id) as interested_count
      FROM events e
      LEFT JOIN events_categories ec ON e.event_category = ec.category_id
      LEFT JOIN events_members em_going ON e.event_id = em_going.event_id AND em_going.is_going = '1'
      LEFT JOIN events_members em_interested ON e.event_id = em_interested.event_id AND em_interested.is_interested = '1'
      WHERE e.event_category = ?
    `;

      const queryParams = [categoryId];

      // Apply privacy filters
      if (userId) {
        query += ` AND (
        e.event_privacy = 'public' 
        OR e.event_admin = ?
        OR EXISTS (
          SELECT 1 FROM events_members em 
          WHERE em.event_id = e.event_id 
          AND em.user_id = ? 
          AND (em.is_going = '1' OR em.is_interested = '1')
        )
      )`;
        queryParams.push(userId, userId);
      } else {
        query += ` AND e.event_privacy = 'public'`;
      }

      query += ` GROUP BY e.event_id ORDER BY e.event_date DESC LIMIT ? OFFSET ?`;
      queryParams.push(parseInt(limit), parseInt(offset));

      const [events] = await pool.query(query, queryParams);

      // Get total count
      let countQuery =
        "SELECT COUNT(*) as total FROM events e WHERE e.event_category = ?";
      const countParams = [categoryId];

      if (userId) {
        countQuery += ` AND (
        e.event_privacy = 'public' 
        OR e.event_admin = ?
        OR EXISTS (
          SELECT 1 FROM events_members em 
          WHERE em.event_id = e.event_id 
          AND em.user_id = ? 
          AND (em.is_going = '1' OR em.is_interested = '1')
        )
      )`;
        countParams.push(userId, userId);
      } else {
        countQuery += ` AND e.event_privacy = 'public'`;
      }

      const [[countResult]] = await pool.query(countQuery, countParams);

      // Process event covers
      const processedEvents = await Promise.all(
        events.map(async (event) => {
          if (event.event_cover) {
            try {
              event.event_cover_url = await storageManager.getPublicUrl(
                event.event_cover_storage_type || "local",
                event.event_cover,
                event.event_cover_storage_data,
              );
            } catch (error) {
              event.event_cover_url = null;
            }
          }
          return event;
        }),
      );

      res.json({
        success: true,
        data: {
          category: categories[0],
          events: processedEvents,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: countResult.total,
            totalPages: Math.ceil(countResult.total / limit),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 34. GET PAST EVENTS
  static async getPastEvents(req, res, next) {
    try {
      const userId = EventsController.getCurrentUserId(req);
      const { page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      let query = `
      SELECT e.*, 
             ec.category_name,
             COUNT(DISTINCT em_going.user_id) as going_count,
             COUNT(DISTINCT em_interested.user_id) as interested_count
      FROM events e
      LEFT JOIN events_categories ec ON e.event_category = ec.category_id
      LEFT JOIN events_members em_going ON e.event_id = em_going.event_id AND em_going.is_going = '1'
      LEFT JOIN events_members em_interested ON e.event_id = em_interested.event_id AND em_interested.is_interested = '1'
      WHERE e.event_end_date < NOW()
    `;

      const queryParams = [];

      // Apply privacy filters
      if (userId) {
        query += ` AND (
        e.event_privacy = 'public' 
        OR e.event_admin = ?
        OR EXISTS (
          SELECT 1 FROM events_members em 
          WHERE em.event_id = e.event_id 
          AND em.user_id = ? 
          AND (em.is_going = '1' OR em.is_interested = '1')
        )
      )`;
        queryParams.push(userId, userId);
      } else {
        query += ` AND e.event_privacy = 'public'`;
      }

      query += ` GROUP BY e.event_id ORDER BY e.event_end_date DESC LIMIT ? OFFSET ?`;
      queryParams.push(parseInt(limit), parseInt(offset));

      const [events] = await pool.query(query, queryParams);

      // Get total count
      const [countResult] = await pool.query(
        `SELECT COUNT(*) as total FROM events e WHERE e.event_end_date < NOW() ${
          userId
            ? `AND (e.event_privacy = 'public' OR e.event_admin = ?)`
            : `AND e.event_privacy = 'public'`
        }`,
        userId ? [userId] : [],
      );

      // Process event covers
      const processedEvents = await Promise.all(
        events.map(async (event) => {
          if (event.event_cover) {
            try {
              event.event_cover_url = await storageManager.getPublicUrl(
                event.event_cover_storage_type || "local",
                event.event_cover,
                event.event_cover_storage_data,
              );
            } catch (error) {
              event.event_cover_url = null;
            }
          }
          return event;
        }),
      );

      res.json({
        success: true,
        data: processedEvents,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult[0].total,
          totalPages: Math.ceil(countResult[0].total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 35. GET FEATURED EVENTS
  static async getFeaturedEvents(req, res, next) {
    try {
      const userId = EventsController.getCurrentUserId(req);
      const { page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      // Featured events could be based on:
      // 1. Most popular (highest going count)
      // 2. Recently created with many members
      // 3. Events with high engagement

      let query = `
      SELECT e.*, 
             ec.category_name,
             COUNT(DISTINCT em_going.user_id) as going_count,
             COUNT(DISTINCT em_interested.user_id) as interested_count,
             (e.event_going + e.event_interested) as total_engagement
      FROM events e
      LEFT JOIN events_categories ec ON e.event_category = ec.category_id
      LEFT JOIN events_members em_going ON e.event_id = em_going.event_id AND em_going.is_going = '1'
      LEFT JOIN events_members em_interested ON e.event_id = em_interested.event_id AND em_interested.is_interested = '1'
      WHERE e.event_start_date > NOW() AND e.event_privacy = 'public'
    `;

      const queryParams = [];

      // Apply privacy filters for non-public viewing
      if (userId) {
        query = query.replace(
          "e.event_privacy = 'public'",
          `(e.event_privacy = 'public' OR e.event_admin = ?)`,
        );
        queryParams.push(userId);
      }

      query += ` GROUP BY e.event_id 
               ORDER BY total_engagement DESC, e.event_date DESC 
               LIMIT ? OFFSET ?`;
      queryParams.push(parseInt(limit), parseInt(offset));

      const [events] = await pool.query(query, queryParams);

      // Get total count
      let countQuery =
        "SELECT COUNT(*) as total FROM events e WHERE e.event_start_date > NOW()";
      const countParams = [];

      if (userId) {
        countQuery += ` AND (e.event_privacy = 'public' OR e.event_admin = ?)`;
        countParams.push(userId);
      } else {
        countQuery += ` AND e.event_privacy = 'public'`;
      }

      const [[countResult]] = await pool.query(countQuery, countParams);

      // Process event covers
      const processedEvents = await Promise.all(
        events.map(async (event) => {
          if (event.event_cover) {
            try {
              event.event_cover_url = await storageManager.getPublicUrl(
                event.event_cover_storage_type || "local",
                event.event_cover,
                event.event_cover_storage_data,
              );
            } catch (error) {
              event.event_cover_url = null;
            }
          }
          return event;
        }),
      );

      res.json({
        success: true,
        data: processedEvents,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.total,
          totalPages: Math.ceil(countResult.total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 36. GET EVENT CHAT (if chatbox_enabled = '1')
  static async getEventChat(req, res, next) {
    try {
      const { eventId } = req.params;
      const userId = EventsController.getCurrentUserId(req);
      const { page = 1, limit = 50 } = req.query;
      const offset = (page - 1) * limit;

      if (!userId) {
        throw new UnauthorizedEventError("Authentication required");
      }

      // Check if user has access to event
      const canAccess = await EventsController.checkEventPrivacy(
        eventId,
        userId,
      );
      if (!canAccess) {
        throw new UnauthorizedEventError("You don't have access to this event");
      }

      // Check if event chat is enabled
      const [event] = await pool.query(
        "SELECT chatbox_enabled, chatbox_conversation_id FROM events WHERE event_id = ?",
        [eventId],
      );

      if (event.length === 0) {
        throw new EventNotFoundError();
      }

      if (event[0].chatbox_enabled !== "1") {
        throw new ValidationEventError("Event chat is not enabled");
      }

      const conversationId = event[0].chatbox_conversation_id;

      if (!conversationId) {
        // No chat messages yet
        return res.json({
          success: true,
          data: [],
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: 0,
            totalPages: 0,
          },
        });
      }

      // Get chat messages
      const [messages] = await pool.query(
        `SELECT cm.*, 
              u.user_name, u.user_firstname, u.user_lastname, u.user_picture,
              u.user_verified
       FROM conversations_messages cm
       JOIN users u ON cm.user_id = u.user_id
       WHERE cm.conversation_id = ?
       ORDER BY cm.time DESC
       LIMIT ? OFFSET ?`,
        [conversationId, parseInt(limit), parseInt(offset)],
      );

      // Get total count
      const [[countResult]] = await pool.query(
        "SELECT COUNT(*) as total FROM conversations_messages WHERE conversation_id = ?",
        [conversationId],
      );

      // Process message images and user pictures
      const processedMessages = await Promise.all(
        messages.map(async (message) => {
          if (message.image) {
            try {
              message.image_url = await storageManager.getPublicUrl(
                "local",
                message.image,
              );
            } catch (error) {
              message.image_url = null;
            }
          }

          if (message.user_picture) {
            try {
              message.user_picture_url = await storageManager.getPublicUrl(
                "local",
                message.user_picture,
              );
            } catch (error) {
              message.user_picture_url = null;
            }
          }

          return message;
        }),
      );

      res.json({
        success: true,
        data: processedMessages,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.total,
          totalPages: Math.ceil(countResult.total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 37. SEND CHAT MESSAGE
  static async sendChatMessage(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { eventId } = req.params;
      const userId = EventsController.getCurrentUserId(req);
      const { message, image } = req.body;

      if (!userId) {
        throw new UnauthorizedEventError("Authentication required");
      }

      if (!message?.trim() && !image) {
        throw new ValidationEventError("Message or image is required");
      }

      // Check if user has access to event
      const canAccess = await EventsController.checkEventPrivacy(
        eventId,
        userId,
      );
      if (!canAccess) {
        throw new UnauthorizedEventError("You don't have access to this event");
      }

      // Check if event chat is enabled
      const [event] = await connection.query(
        "SELECT chatbox_enabled, chatbox_conversation_id FROM events WHERE event_id = ?",
        [eventId],
      );

      if (event.length === 0) {
        throw new EventNotFoundError();
      }

      if (event[0].chatbox_enabled !== "1") {
        throw new ValidationEventError("Event chat is not enabled");
      }

      let conversationId = event[0].chatbox_conversation_id;

      // Create conversation if doesn't exist
      if (!conversationId) {
        // Create new conversation
        const [convResult] = await connection.query(
          "INSERT INTO conversations (node_id, node_type, last_message_id) VALUES (?, 'event', 0)",
          [eventId],
        );

        conversationId = convResult.insertId;

        // Update event with conversation ID
        await connection.query(
          "UPDATE events SET chatbox_conversation_id = ? WHERE event_id = ?",
          [conversationId, eventId],
        );

        // Add all event members to conversation
        const [members] = await connection.query(
          "SELECT user_id FROM events_members WHERE event_id = ? AND (is_going = '1' OR is_interested = '1')",
          [eventId],
        );

        for (const member of members) {
          await connection.query(
            "INSERT INTO conversations_users (conversation_id, user_id, seen, typing, deleted) VALUES (?, ?, '0', '0', '0')",
            [conversationId, member.user_id],
          );
        }
      }

      // Handle image upload if provided
      let imagePath = null;
      if (image) {
        const imageResult = await handleBase64Upload(
          image,
          `event-chat-${eventId}-${Date.now()}.jpg`,
          "events/chat",
        );
        imagePath = imageResult.path;
      }

      // Create message
      const [messageResult] = await connection.query(
        `INSERT INTO conversations_messages 
       (conversation_id, user_id, message, image, time) 
       VALUES (?, ?, ?, ?, NOW())`,
        [conversationId, userId, message || null, imagePath],
      );

      const messageId = messageResult.insertId;

      // Update conversation last message
      await connection.query(
        "UPDATE conversations SET last_message_id = ? WHERE conversation_id = ?",
        [messageId, conversationId],
      );

      // Mark message as unseen for all members except sender
      await connection.query(
        `UPDATE conversations_users 
       SET seen = '0' 
       WHERE conversation_id = ? AND user_id != ?`,
        [conversationId, userId],
      );

      await connection.commit();

      // Log activity
      await logActivity(
        userId,
        "event_chat_message",
        `Sent message in event chat`,
        eventId,
        "event",
      );

      // TODO: Send real-time notifications to other members

      res.status(201).json({
        success: true,
        message: "Message sent successfully",
        data: {
          message_id: messageId,
          conversation_id: conversationId,
        },
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 38. GET EVENT TICKETS
  static async getEventTickets(req, res, next) {
    try {
      const { eventId } = req.params;

      // Check event exists
      const [event] = await pool.query(
        "SELECT event_tickets_link FROM events WHERE event_id = ?",
        [eventId],
      );

      if (event.length === 0) {
        throw new EventNotFoundError();
      }

      res.json({
        success: true,
        data: {
          tickets_link: event[0].event_tickets_link,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // 39. PURCHASE TICKET
  static async purchaseTicket(req, res, next) {
    // This would integrate with a payment system
    // For now, just record the intent
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { eventId } = req.params;
      const userId = EventsController.getCurrentUserId(req);
      const { ticket_type, quantity = 1 } = req.body;

      if (!userId) {
        throw new UnauthorizedEventError("Authentication required");
      }

      // Check event exists and has tickets
      const [event] = await connection.query(
        "SELECT event_tickets_link, event_prices FROM events WHERE event_id = ?",
        [eventId],
      );

      if (event.length === 0) {
        throw new EventNotFoundError();
      }

      if (!event[0].event_tickets_link) {
        throw new ValidationEventError(
          "This event doesn't have tickets available",
        );
      }

      // Parse event prices if available
      let prices = null;
      if (event[0].event_prices) {
        try {
          prices = JSON.parse(event[0].event_prices);
        } catch (error) {
          console.error("Failed to parse event prices:", error);
        }
      }

      // Record purchase intent (in a real system, this would create an order)
      const purchaseData = {
        event_id: eventId,
        user_id: userId,
        ticket_type,
        quantity,
        prices: prices,
        status: "pending",
        purchase_time: new Date(),
      };

      // TODO: Integrate with payment system
      // For now, just return the tickets link

      await connection.commit();

      res.json({
        success: true,
        message: "Redirect to ticket purchase",
        data: {
          tickets_link: event[0].event_tickets_link,
          redirect: true,
        },
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  // 40. GET EVENT PRICES
  static async getEventPrices(req, res, next) {
    try {
      const { eventId } = req.params;

      // Check event exists
      const [event] = await pool.query(
        "SELECT event_prices FROM events WHERE event_id = ?",
        [eventId],
      );

      if (event.length === 0) {
        throw new EventNotFoundError();
      }

      let prices = null;
      if (event[0].event_prices) {
        try {
          prices = JSON.parse(event[0].event_prices);
        } catch (error) {
          console.error("Failed to parse event prices:", error);
          prices = null;
        }
      }

      res.json({
        success: true,
        data: {
          prices: prices,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = EventsController;
