const db = require("../config/db");
const { uploadToGoogleCloud } = require("../utils/googleCloud");
const { isGoogleCloudActive } = require("../utils/isGoogleCloudActive");
// REMOVE: const { broadcastStoryToFriends } = require("../index");
// REMOVE: const { getIO } = require("../socket");
const storageManager = require("../utils/storageManager");
const fs = require("fs").promises;

// Import the socketController from index.js
const { socketController } = require("../index");

// Post a new story (with real-time broadcast)
exports.postStory = async (req, res) => {
  let connection;
  let file;

  try {
    const text = req.body.text ? String(req.body.text).trim() : "";
    file = req.file;
    const user_id = req.user?.id || req.userId;

    if (!user_id) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    if (!file) {
      return res.status(400).json({
        success: false,
        error: "Media file is required",
      });
    }

    // Check for active stories
    const [activeStories] = await db.query(
      `SELECT story_id, media_count 
       FROM stories 
       WHERE user_id = ? 
       AND time >= NOW() - INTERVAL 24 HOUR
       LIMIT 1`,
      [user_id]
    );

    let story_id;
    const hasActiveStory = activeStories.length > 0;

    // Start transaction
    connection = await db.beginTransaction();

    // Upload media to cloud storage
    console.log("📤 Uploading to cloud storage...");
    const uploadResult = await storageManager.upload(file, "stories");

    if (!uploadResult?.path) {
      throw new Error("Failed to upload media to cloud storage");
    }

    // Make sure storage_data is a string for database
    const storageDataString =
      typeof uploadResult.storage_data === "string"
        ? uploadResult.storage_data
        : JSON.stringify(uploadResult.storage_data || {});

    // Check database column type for is_photo
    const [columnInfo] = await db.query(
      `SHOW COLUMNS FROM stories_media LIKE 'is_photo'`
    );

    console.log("is_photo column info:", columnInfo[0]);

    // Convert is_photo to appropriate type
    const isPhotoValue = file.mimetype.startsWith("image/") ? "1" : "0";

    // Determine correct database value type
    let dbIsPhotoValue;
    const columnType = columnInfo[0]?.Type?.toLowerCase() || "";

    if (columnType.includes("tinyint") || columnType.includes("boolean")) {
      dbIsPhotoValue = isPhotoValue;
    } else if (columnType.includes("char") || columnType.includes("varchar")) {
      dbIsPhotoValue = isPhotoValue.toString();
    } else {
      dbIsPhotoValue = isPhotoValue;
    }

    if (hasActiveStory) {
      // Add to existing story
      story_id = activeStories[0].story_id;

      await connection.query(
        `INSERT INTO stories_media 
         (story_id, source, storage_type, storage_data, is_photo, text, time, thumbnail_path) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          story_id,
          uploadResult.path,
          uploadResult.storage_type,
          storageDataString,
          dbIsPhotoValue,
          text || null,
          new Date(),
          uploadResult.thumbnail_url || null,
        ]
      );

      // Update story time and count
      await connection.query(
        `UPDATE stories SET time = ?, media_count = media_count + 1 WHERE story_id = ?`,
        [new Date(), story_id]
      );
    } else {
      // Create new story
      const [storyResult] = await db.query(
        `INSERT INTO stories (user_id, is_ads, time, media_count) 
         VALUES (?, ?, ?, ?)`,
        [user_id, "0", new Date(), 1]
      );

      story_id = storyResult.insertId;

      await connection.query(
        `INSERT INTO stories_media 
         (story_id, source, storage_type, storage_data, is_photo, text, time, thumbnail_path) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          story_id,
          uploadResult.path,
          uploadResult.storage_type,
          storageDataString,
          dbIsPhotoValue,
          text || null,
          new Date(),
          uploadResult.thumbnail_url || null,
        ]
      );
    }

    await db.commit(connection);

    // Get story data with full URLs
    const [storyData] = await db.query(
      `
      SELECT 
          s.story_id,
          s.user_id,
          u.user_name,
          u.user_picture as profile_pic,
          sm.media_id,
          sm.source,
          sm.storage_type,
          sm.storage_data,
          sm.thumbnail_path,
          sm.is_photo,
          sm.text,
          sm.time as media_time,
          s.time as story_time,
          s.media_count
      FROM stories s
      JOIN stories_media sm ON s.story_id = sm.story_id
      JOIN users u ON s.user_id = u.user_id
      WHERE s.story_id = ?
      ORDER BY sm.time DESC
      `,
      [story_id]
    );

    if (storyData.length === 0) {
      throw new Error("Failed to retrieve story data");
    }

    // Convert paths to full URLs
    const processedStory = {
      story_id,
      user_id: storyData[0].user_id,
      username: storyData[0].user_name,
      profile_pic: storyData[0].profile_pic,
      time: storyData[0].story_time,
      media: storyData.map((media) => {
        // Handle both string and object storage_data
        let storageData;
        if (typeof media.storage_data === "string") {
          try {
            storageData = JSON.parse(media.storage_data);
          } catch {
            storageData = {};
          }
        } else {
          storageData = media.storage_data || {};
        }

        return {
          media_id: media.media_id,
          source: storageManager.getPublicUrl(media.storage_type, media.source),
          thumbnail:
            media.thumbnail_path ||
            storageManager.getPublicUrl(media.storage_type, media.source),
          storage_type: media.storage_type,
          is_photo: media.is_photo,
          text: media.text,
          time: media.media_time,
          duration: storageData?.duration,
          dimensions:
            storageData?.width && storageData?.height
              ? { width: storageData.width, height: storageData.height }
              : null,
        };
      }),
      media_count: storyData[0].media_count,
      hasUnseenStory: true,
      is_new_story: !hasActiveStory,
    };

    // ✅ UPDATED: Broadcast via SocketController
    if (socketController) {
      await socketController.broadcastStoryToFriends(user_id, processedStory);
    } else {
      console.warn("⚠️ SocketController not available for story broadcast");
    }

    res.status(201).json({
      success: true,
      story_id,
      media_url: uploadResult.public_url,
      thumbnail_url: uploadResult.thumbnail_url || uploadResult.public_url,
      story: processedStory,
      storage_type: uploadResult.storage_type,
      message: hasActiveStory ? "Added to existing story" : "New story created",
    });
  } catch (error) {
    if (connection) {
      await db.rollback(connection);
    }

    console.error("❌ Error posting story:", error);

    // Clean up uploaded file from temp location
    if (file && file.path) {
      try {
        await fs.unlink(file.path);
      } catch (cleanupError) {
        console.error("Cleanup error:", cleanupError);
      }
    }

    res.status(500).json({
      success: false,
      error: "Failed to post story",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Get stories feed with URL conversion
exports.getStoriesFeed = async (req, res) => {
  try {
    const { last_updated, limit = 50 } = req.query;
    const user_id = req.user?.id || req.userId;

    if (!user_id) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    // Get stories with media in single query
    const [stories] = await db.query(
      `
      SELECT 
          s.story_id,
          s.user_id,
          u.user_name,
          u.user_picture as profile_pic,
          s.time as story_time,
          s.media_count,
          (
              SELECT COUNT(*) 
              FROM story_views sv 
              WHERE sv.story_id = s.story_id
          ) as view_count,
          EXISTS(
              SELECT 1 FROM story_views sv2 
              WHERE sv2.story_id = s.story_id 
              AND sv2.user_id = ?
          ) as has_seen,
          (
              SELECT JSON_ARRAYAGG(
                  JSON_OBJECT(
                      'media_id', sm.media_id,
                      'source', sm.source,
                      'storage_type', sm.storage_type,
                      'storage_data', sm.storage_data,
                      'thumbnail_path', sm.thumbnail_path,
                      'is_photo', sm.is_photo,
                      'text', sm.text,
                      'time', sm.time
                  )
              )
              FROM stories_media sm
              WHERE sm.story_id = s.story_id
              ORDER BY sm.time DESC
          ) as media_json
      FROM stories s
      JOIN users u ON s.user_id = u.user_id
      WHERE s.user_id IN (
          SELECT 
              CASE 
                  WHEN user_one_id = ? THEN user_two_id
                  ELSE user_one_id
              END as friend_id
          FROM friends
          WHERE (user_one_id = ? OR user_two_id = ?)
          AND status = 1
          UNION ALL
          SELECT ?
      )
      AND s.time >= NOW() - INTERVAL 24 HOUR
      ${last_updated ? "AND s.time > ?" : ""}
      ORDER BY s.time DESC
      LIMIT ?
      `,
      last_updated
        ? [
            user_id,
            user_id,
            user_id,
            user_id,
            user_id,
            new Date(last_updated),
            parseInt(limit),
          ]
        : [user_id, user_id, user_id, user_id, user_id, parseInt(limit)]
    );

    // Process stories and convert paths to URLs
    const processedStories = stories.map((story) => {
      const media = Array.isArray(story.media_json)
        ? story.media_json
        : story.media_json
          ? JSON.parse(story.media_json)
          : [];

      const processedMedia = media.map((m) => {
        // Handle both string and object storage_data
        let storageData;
        if (typeof m.storage_data === "string") {
          try {
            storageData = JSON.parse(m.storage_data);
          } catch {
            storageData = {};
          }
        } else {
          storageData = m.storage_data || {};
        }

        return {
          media_id: m.media_id,
          source: storageManager.getPublicUrl(m.storage_type, m.source),
          thumbnail:
            m.thumbnail_path ||
            storageManager.getPublicUrl(m.storage_type, m.source),
          storage_type: m.storage_type,
          is_photo: m.is_photo,
          text: m.text,
          time: m.time,
          duration: storageData?.duration,
          dimensions:
            storageData?.width && storageData?.height
              ? { width: storageData.width, height: storageData.height }
              : null,
        };
      });

      return {
        story_id: story.story_id,
        user_id: story.user_id,
        username: story.user_name,
        profile_pic: story.profile_pic,
        time: story.story_time,
        media: processedMedia,
        media_count: story.media_count,
        view_count: story.view_count || 0,
        hasUnseenStory: story.user_id !== parseInt(user_id) && !story.has_seen,
        isMyStory: story.user_id === parseInt(user_id),
        last_updated: media.length > 0 ? media[0].time : story.story_time,
      };
    });

    res.status(200).json({
      success: true,
      stories: processedStories,
      last_updated: new Date().toISOString(),
      has_new_stories: processedStories.length > 0,
      stats: {
        story_count: processedStories.length,
        unviewed_count: processedStories.filter((s) => s.hasUnseenStory).length,
      },
    });
  } catch (error) {
    console.error("Error fetching stories feed:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch stories",
    });
  }
};

// Mark story as viewed
exports.markStoryViewed = async (req, res) => {
  try {
    const story_id = req.body.story_id || req.params.story_id;
    const user_id = req.user?.id || req.user?.user_id || req.userId;

    if (story_id === undefined || story_id === null || !user_id) {
      return res
        .status(400)
        .json({ error: "Story ID and User ID are required" });
    }

    const [storyCheck] = await db.query(
      `SELECT s.user_id as story_owner
       FROM stories s
       LEFT JOIN friends f ON (
         (f.user_one_id = ? AND f.user_two_id = s.user_id) OR
         (f.user_two_id = ? AND f.user_one_id = s.user_id)
       )
       WHERE s.story_id = ?
       AND (s.user_id = ? OR f.status = 1)
       AND s.time >= NOW() - INTERVAL 24 HOUR`,
      [user_id, user_id, story_id, user_id]
    );

    if (storyCheck.length === 0) {
      return res
        .status(404)
        .json({ error: "Story not found or not accessible" });
    }

    // ✅ idempotent insert
    await db.query(
      `INSERT INTO story_views (story_id, user_id, viewed_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE viewed_at = VALUES(viewed_at)`,
      [story_id, user_id, new Date()]
    );

    // Get viewer info
    const [viewer] = await db.query(
      `SELECT user_name, user_picture FROM users WHERE user_id = ?`,
      [user_id]
    );

    // ✅ UPDATED: Use socketController to send notification
    if (socketController) {
      const view_count = await getViewCount(story_id);

      // Send notification to story owner
      socketController.sendNotification(storyCheck[0].story_owner, {
        type: "STORY_VIEWED",
        story_id,
        viewer: {
          user_id,
          username: viewer[0]?.user_name || "Unknown",
          profile_pic: viewer[0]?.user_picture,
        },
        timestamp: new Date().toISOString(),
        view_count,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Story marked as viewed",
      viewed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error marking story as viewed:", error);
    return res.status(500).json({ error: "Failed to mark story as viewed" });
  }
};

// Get stories by specific user
exports.getUserStories = async (req, res) => {
  try {
    const { userId } = req.params;
    const requestingUserId = req.user.user_id;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    // Check friendship status
    const [friendship] = await db.query(
      `SELECT status FROM friends 
       WHERE (user_one_id = ? AND user_two_id = ?) 
       OR (user_one_id = ? AND user_two_id = ?)`,
      [requestingUserId, userId, userId, requestingUserId]
    );

    const isFriend = friendship.length > 0 && friendship[0].status === 1;
    const isSelf = parseInt(userId) === requestingUserId;

    if (!isFriend && !isSelf) {
      return res
        .status(403)
        .json({ error: "Not authorized to view these stories" });
    }

    const [stories] = await db.query(
      `
      SELECT 
          s.story_id,
          s.user_id,
          u.user_name,
          u.user_picture as profile_pic,
          sm.media_id,
          sm.source,
          sm.is_photo,
          sm.text,
          sm.time as media_time,
          s.time as story_time,
          COUNT(DISTINCT sv.viewer_id) as view_count
      FROM stories s
      JOIN stories_media sm ON s.story_id = sm.story_id
      JOIN users u ON s.user_id = u.user_id
      LEFT JOIN story_views sv ON s.story_id = sv.story_id
      WHERE s.user_id = ?
      AND s.time >= NOW() - INTERVAL 24 HOUR
      GROUP BY s.story_id, sm.media_id, u.user_name, u.user_picture
      ORDER BY s.time DESC, sm.time DESC
      `,
      [userId]
    );

    // Group stories
    const groupedStories = stories.reduce((acc, item) => {
      const existingStory = acc.find((s) => s.story_id === item.story_id);

      const mediaItem = {
        media_id: item.media_id,
        source: item.source,
        is_photo: item.is_photo,
        text: item.text,
        time: item.media_time,
      };

      if (existingStory) {
        existingStory.media.push(mediaItem);
      } else {
        acc.push({
          story_id: item.story_id,
          user_id: item.user_id,
          username: item.user_name,
          profile_pic: item.profile_pic,
          time: item.story_time,
          media: [mediaItem],
          view_count: item.view_count || 0,
          isMyStory: parseInt(userId) === requestingUserId,
        });
      }

      return acc;
    }, []);

    res.status(200).json({
      success: true,
      stories: groupedStories,
      user_info: {
        user_id: userId,
        username: stories[0]?.user_name,
        profile_pic: stories[0]?.profile_pic,
      },
    });
  } catch (error) {
    console.error("Error fetching user stories:", error);
    res.status(500).json({ error: "Failed to fetch user stories" });
  }
};

// Get story by ID
exports.getStoryById = async (req, res) => {
  try {
    const { storyId } = req.params;
    const user_id = req.user.user_id;

    const [story] = await db.query(
      `
      SELECT 
          s.story_id,
          s.user_id,
          u.user_name,
          u.user_picture as profile_pic,
          sm.media_id,
          sm.source,
          sm.is_photo,
          sm.text,
          sm.time as media_time,
          s.time as story_time,
          COUNT(DISTINCT sv.viewer_id) as view_count,
          EXISTS(
            SELECT 1 FROM story_views sv2 
            WHERE sv2.story_id = s.story_id 
            AND sv2.user_id = ?
          ) as has_seen
      FROM stories s
      JOIN stories_media sm ON s.story_id = sm.story_id
      JOIN users u ON s.user_id = u.user_id
      LEFT JOIN story_views sv ON s.story_id = sv.story_id
      WHERE s.story_id = ?
      GROUP BY s.story_id, sm.media_id, u.user_name, u.user_picture
      ORDER BY sm.time DESC
      `,
      [user_id, storyId]
    );

    if (story.length === 0) {
      return res.status(404).json({ error: "Story not found" });
    }

    // Group media
    const groupedStory = story.reduce((acc, item) => {
      if (!acc.story) {
        acc.story = {
          story_id: item.story_id,
          user_id: item.user_id,
          username: item.user_name,
          profile_pic: item.profile_pic,
          time: item.story_time,
          view_count: item.view_count || 0,
          has_seen: item.has_seen,
          media: [],
        };
      }
      acc.story.media.push({
        media_id: item.media_id,
        source: item.source,
        is_photo: item.is_photo,
        text: item.text,
        time: item.media_time,
      });
      return acc;
    }, {}).story;

    res.status(200).json({
      success: true,
      story: groupedStory,
    });
  } catch (error) {
    console.error("Error fetching story:", error);
    res.status(500).json({ error: "Failed to fetch story" });
  }
};

// Delete a story
exports.deleteStory = async (req, res) => {
  try {
    const { storyId } = req.params;
    const user_id = req.user.user_id;

    // Check ownership
    const [story] = await db.query(
      `SELECT user_id FROM stories WHERE story_id = ?`,
      [storyId]
    );

    if (story.length === 0) {
      return res.status(404).json({ error: "Story not found" });
    }

    if (story[0].user_id !== user_id) {
      return res.status(403).json({ error: "Not authorized" });
    }

    // Get all media for deletion
    const [mediaList] = await db.query(
      `SELECT source, storage_type, storage_data FROM stories_media WHERE story_id = ?`,
      [storyId]
    );

    await db.beginTransaction();

    try {
      // Delete related data
      await db.query(`DELETE FROM story_views WHERE story_id = ?`, [storyId]);
      await db.query(`DELETE FROM story_reactions WHERE story_id = ?`, [
        storyId,
      ]);
      await db.query(`DELETE FROM stories_media WHERE story_id = ?`, [storyId]);
      await db.query(`DELETE FROM stories WHERE story_id = ?`, [storyId]);

      await db.commit();

      // Delete files from cloud storage (async, don't wait)
      mediaList.forEach(async (media) => {
        try {
          const storageData = media.storage_data
            ? JSON.parse(media.storage_data)
            : null;
          await storageManager.deleteFile(
            media.storage_type,
            media.source,
            storageData
          );
        } catch (deleteError) {
          console.error(
            `Failed to delete ${media.source}:`,
            deleteError.message
          );
        }
      });

      // ✅ UPDATED: Notify via SocketController
      if (socketController) {
        socketController.io.emit("story-deleted", {
          type: "STORY_DELETED",
          story_id: storyId,
          user_id,
          timestamp: new Date().toISOString(),
        });
      }

      res.status(200).json({
        success: true,
        message: "Story deleted successfully",
        media_count: mediaList.length,
      });
    } catch (err) {
      await db.rollback();
      throw err;
    }
  } catch (error) {
    console.error("Error deleting story:", error);
    res.status(500).json({
      error: "Failed to delete story",
      details: error.message,
    });
  }
};

// Get story viewers
exports.getStoryViewers = async (req, res) => {
  try {
    const { storyId } = req.params;
    const user_id = req.user.user_id;

    // Check if user owns the story or is a friend
    const [story] = await db.query(
      `SELECT user_id FROM stories WHERE story_id = ?`,
      [storyId]
    );

    if (story.length === 0) {
      return res.status(404).json({ error: "Story not found" });
    }

    const isOwner = story[0].user_id === user_id;

    if (!isOwner) {
      // Check friendship
      const [friendship] = await db.query(
        `SELECT status FROM friends 
         WHERE (user_one_id = ? AND user_two_id = ?) 
         OR (user_one_id = ? AND user_two_id = ?)`,
        [user_id, story[0].user_id, story[0].user_id, user_id]
      );

      if (friendship.length === 0 || friendship[0].status !== 1) {
        return res
          .status(403)
          .json({ error: "Not authorized to view viewers" });
      }
    }

    const [viewers] = await db.query(
      `
      SELECT 
          u.user_id,
          u.user_name,
          u.user_picture,
          sv.viewed_at
      FROM story_views sv
      JOIN users u ON sv.user_id = u.user_id
      WHERE sv.story_id = ?
      ORDER BY sv.viewed_at DESC
      `,
      [storyId]
    );

    res.status(200).json({
      success: true,
      viewers: viewers,
      count: viewers.length,
    });
  } catch (error) {
    console.error("Error fetching story viewers:", error);
    res.status(500).json({ error: "Failed to fetch story viewers" });
  }
};

// React to story
exports.reactToStory = async (req, res) => {
  try {
    const { storyId } = req.params;
    const { reaction } = req.body;
    const user_id = req.user.user_id;

    // Validate reaction
    const validReactions = ["like", "love", "haha", "wow", "sad", "angry"];
    if (!validReactions.includes(reaction)) {
      return res.status(400).json({ error: "Invalid reaction" });
    }

    // Check if user can view the story
    const [story] = await db.query(
      `SELECT s.user_id as owner_id
       FROM stories s
       LEFT JOIN friends f ON (
         (f.user_one_id = ? AND f.user_two_id = s.user_id) OR
         (f.user_two_id = ? AND f.user_one_id = s.user_id)
       )
       WHERE s.story_id = ? 
       AND (s.user_id = ? OR f.status = 1)`,
      [user_id, user_id, storyId, user_id]
    );

    if (story.length === 0) {
      return res
        .status(404)
        .json({ error: "Story not found or not accessible" });
    }

    // Check if already reacted
    const [existingReaction] = await db.query(
      `SELECT reaction FROM story_reactions 
       WHERE story_id = ? AND user_id = ?`,
      [storyId, user_id]
    );

    if (existingReaction.length > 0) {
      if (existingReaction[0].reaction === reaction) {
        // Remove reaction if same
        await db.query(
          `DELETE FROM story_reactions WHERE story_id = ? AND user_id = ?`,
          [storyId, user_id]
        );
      } else {
        // Update reaction
        await db.query(
          `UPDATE story_reactions SET reaction = ?, reacted_at = ? 
           WHERE story_id = ? AND user_id = ?`,
          [reaction, new Date(), storyId, user_id]
        );
      }
    } else {
      // Add new reaction
      await db.query(
        `INSERT INTO story_reactions (story_id, user_id, reaction, reacted_at) 
         VALUES (?, ?, ?, ?)`,
        [storyId, user_id, reaction, new Date()]
      );
    }

    // Get updated reaction counts
    const [reactions] = await db.query(
      `SELECT reaction, COUNT(*) as count 
       FROM story_reactions 
       WHERE story_id = ? 
       GROUP BY reaction`,
      [storyId]
    );

    // ✅ UPDATED: Notify story owner via SocketController
    const [reactor] = await db.query(
      `SELECT user_name FROM users WHERE user_id = ?`,
      [user_id]
    );

    if (socketController) {
      const reactionCounts = reactions.reduce((acc, r) => {
        acc[r.reaction] = r.count;
        return acc;
      }, {});

      socketController.sendNotification(story[0].owner_id, {
        type: "STORY_REACTED",
        story_id: storyId,
        reactor: {
          user_id,
          username: reactor[0]?.user_name,
        },
        reaction,
        reactions: reactionCounts,
        timestamp: new Date().toISOString(),
      });
    }

    res.status(200).json({
      success: true,
      reaction:
        existingReaction.length > 0 && existingReaction[0].reaction === reaction
          ? null
          : reaction,
      reactions: reactions.reduce((acc, r) => {
        acc[r.reaction] = r.count;
        return acc;
      }, {}),
      message:
        existingReaction.length > 0 && existingReaction[0].reaction === reaction
          ? "Reaction removed"
          : "Reaction added",
    });
  } catch (error) {
    console.error("Error reacting to story:", error);
    res.status(500).json({ error: "Failed to react to story" });
  }
};

// Get story reactions
exports.getStoryReactions = async (req, res) => {
  try {
    const { storyId } = req.params;
    const user_id = req.user.user_id;

    // Check if user can view the story
    const [story] = await db.query(
      `SELECT s.user_id as owner_id
       FROM stories s
       LEFT JOIN friends f ON (
         (f.user_one_id = ? AND f.user_two_id = s.user_id) OR
         (f.user_two_id = ? AND f.user_one_id = s.user_id)
       )
       WHERE s.story_id = ? 
       AND (s.user_id = ? OR f.status = 1)`,
      [user_id, user_id, storyId, user_id]
    );

    if (story.length === 0) {
      return res
        .status(404)
        .json({ error: "Story not found or not accessible" });
    }

    const [reactions] = await db.query(
      `
      SELECT 
          sr.reaction,
          u.user_id,
          u.user_name,
          u.user_picture,
          sr.reacted_at
      FROM story_reactions sr
      JOIN users u ON sr.user_id = u.user_id
      WHERE sr.story_id = ?
      ORDER BY sr.reacted_at DESC
      `,
      [storyId]
    );

    // Group by reaction type
    const groupedReactions = reactions.reduce((acc, item) => {
      if (!acc[item.reaction]) {
        acc[item.reaction] = [];
      }
      acc[item.reaction].push({
        user_id: item.user_id,
        username: item.user_name,
        profile_pic: item.user_picture,
        reacted_at: item.reacted_at,
      });
      return acc;
    }, {});

    const [counts] = await db.query(
      `SELECT reaction, COUNT(*) as count 
       FROM story_reactions 
       WHERE story_id = ? 
       GROUP BY reaction`,
      [storyId]
    );

    const reactionCounts = counts.reduce((acc, item) => {
      acc[item.reaction] = item.count;
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      reactions: groupedReactions,
      counts: reactionCounts,
      total_reactions: reactions.length,
    });
  } catch (error) {
    console.error("Error fetching story reactions:", error);
    res.status(500).json({ error: "Failed to fetch story reactions" });
  }
};

// Check if user has active story
exports.checkActiveStory = async (req, res) => {
  try {
    const user_id = req.user.user_id;

    const [activeStories] = await db.query(
      `
      SELECT 
          s.story_id,
          s.time,
          COUNT(sm.media_id) as media_count,
          MAX(sm.time) as last_media_time
      FROM stories s
      LEFT JOIN stories_media sm ON s.story_id = sm.story_id
      WHERE s.user_id = ?
      AND s.time >= NOW() - INTERVAL 24 HOUR
      GROUP BY s.story_id
      ORDER BY s.time DESC
      LIMIT 1
      `,
      [user_id]
    );

    const hasActiveStory = activeStories.length > 0;

    res.status(200).json({
      success: true,
      has_active_story: hasActiveStory,
      story: hasActiveStory
        ? {
            story_id: activeStories[0].story_id,
            time: activeStories[0].time,
            media_count: activeStories[0].media_count,
            last_media_time: activeStories[0].last_media_time,
          }
        : null,
    });
  } catch (error) {
    console.error("Error checking active story:", error);
    res.status(500).json({ error: "Failed to check active story" });
  }
};

// Get unviewed stories count
exports.getUnviewedCount = async (req, res) => {
  try {
    const user_id = req.user.user_id;

    // Get friend IDs
    const [friends] = await db.query(
      `
      SELECT 
          CASE 
              WHEN user_one_id = ? THEN user_two_id
              ELSE user_one_id
          END as friend_id
      FROM friends
      WHERE (user_one_id = ? OR user_two_id = ?)
      AND status = 1
      `,
      [user_id, user_id, user_id]
    );

    const friendIds = friends.map((f) => f.friend_id);

    if (friendIds.length === 0) {
      return res.status(200).json({
        success: true,
        unviewed_count: 0,
        friends_with_stories: [],
      });
    }

    const [unviewedStories] = await db.query(
      `
      SELECT DISTINCT s.user_id, u.user_name
      FROM stories s
      JOIN users u ON s.user_id = u.user_id
      WHERE s.user_id IN (?)
      AND s.time >= NOW() - INTERVAL 24 HOUR
      AND NOT EXISTS(
        SELECT 1 FROM story_views sv 
        WHERE sv.story_id = s.story_id 
        AND sv.user_id = ?
      )
      `,
      [friendIds, user_id]
    );

    res.status(200).json({
      success: true,
      unviewed_count: unviewedStories.length,
      friends_with_stories: unviewedStories.map((s) => ({
        user_id: s.user_id,
        username: s.user_name,
      })),
    });
  } catch (error) {
    console.error("Error fetching unviewed count:", error);
    res.status(500).json({ error: "Failed to fetch unviewed count" });
  }
};

// Mark all stories as viewed for a user
exports.markAllStoriesViewed = async (req, res) => {
  try {
    const user_id = req.user.user_id;

    // Get all unviewed stories from friends
    const [friends] = await db.query(
      `
      SELECT 
          CASE 
              WHEN user_one_id = ? THEN user_two_id
              ELSE user_one_id
          END as friend_id
      FROM friends
      WHERE (user_one_id = ? OR user_two_id = ?)
      AND status = 1
      `,
      [user_id, user_id, user_id]
    );

    const friendIds = friends.map((f) => f.friend_id);

    if (friendIds.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No friends to mark stories as viewed",
        marked_count: 0,
      });
    }

    const [unviewedStories] = await db.query(
      `
      SELECT DISTINCT s.story_id, s.user_id
      FROM stories s
      WHERE s.user_id IN (?)
      AND s.time >= NOW() - INTERVAL 24 HOUR
      AND NOT EXISTS(
        SELECT 1 FROM story_views sv 
        WHERE sv.story_id = s.story_id 
        AND sv.user_id = ?
      )
      `,
      [friendIds, user_id]
    );

    // Mark all as viewed
    const markedStories = [];
    for (const story of unviewedStories) {
      await db.query(
        `INSERT INTO story_views (story_id, user_id, viewed_at) VALUES (?, ?, ?)`,
        [story.story_id, user_id, new Date()]
      );
      markedStories.push(story.story_id);
    }

    // ✅ UPDATED: Notify friends that their stories were viewed via SocketController
    if (socketController) {
      markedStories.forEach(async (storyId) => {
        const story = unviewedStories.find((s) => s.story_id === storyId);
        if (story) {
          const [viewer] = await db.query(
            `SELECT user_name FROM users WHERE user_id = ?`,
            [user_id]
          );

          socketController.sendNotification(story.user_id, {
            type: "STORY_VIEWED",
            story_id: storyId,
            viewer: {
              user_id,
              username: viewer[0]?.user_name,
            },
            timestamp: new Date().toISOString(),
            is_bulk_view: true,
          });
        }
      });
    }

    res.status(200).json({
      success: true,
      message: `Marked ${markedStories.length} stories as viewed`,
      marked_count: markedStories.length,
      story_ids: markedStories,
    });
  } catch (error) {
    console.error("Error marking all stories as viewed:", error);
    res.status(500).json({ error: "Failed to mark stories as viewed" });
  }
};

// Helper function to get view count
async function getViewCount(storyId) {
  const [result] = await db.query(
    `SELECT COUNT(*) as count FROM story_views WHERE story_id = ?`,
    [storyId]
  );
  return result[0]?.count || 0;
}
