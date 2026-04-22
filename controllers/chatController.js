const db = require("../config/db");
const { v4: uuidv4 } = require("uuid");
const NotificationService = require("../services/notificationService");

class ChatController {
  /**
   * Get user's conversations
   */
  static async getUserConversations(req, res) {
    const { user_id } = req.params;

    console.log(`🟢 [GET] /conversations/${user_id}`);

    try {
      const query = `
      SELECT 
        c.conversation_id,
        c.last_message_id,
        c.color,
        c.node_id,
        c.node_type,
        cm.message AS last_message,
        cm.user_id AS last_message_user_id,
        cm.time AS last_message_time,
        cm.image AS last_message_image,
        cm.voice_note AS last_message_voice_note,
        cu.user_id AS other_user_id,
        COALESCE(u.user_name, 'Deleted User') AS other_user_name,
        COALESCE(u.user_picture, 'default-avatar.jpg') AS other_user_picture,
        u.user_verified,
        u.user_firstname,
        u.user_lastname,
        u.user_last_seen,
        cu.seen,
        cu.typing,
        cu.deleted,
        cu.last_seen_time,
        (
          -- Count messages from other users sent after user's last seen time
          SELECT COUNT(*)
          FROM conversations_messages cm2
          WHERE cm2.conversation_id = c.conversation_id
          AND cm2.user_id != ?
          AND cm2.time > COALESCE(cu.last_seen_time, '2000-01-01')
        ) AS unread_count,
        -- Calculate if user is online (active in last 5 minutes)
        CASE 
          WHEN u.user_last_seen IS NOT NULL 
               AND TIMESTAMPDIFF(SECOND, u.user_last_seen, NOW()) <= 300 
          THEN 1
          ELSE 0
        END as is_online
      FROM conversations_users cu
      INNER JOIN conversations c ON cu.conversation_id = c.conversation_id
      LEFT JOIN conversations_messages cm ON c.last_message_id = cm.message_id
      LEFT JOIN users u ON cu.user_id = u.user_id
      WHERE cu.conversation_id IN (
        SELECT conversation_id 
        FROM conversations_users 
        WHERE user_id = ? AND deleted = '0'
      )
      AND cu.user_id != ?
      AND cu.deleted = '0'
      ORDER BY COALESCE(cm.time, '2000-01-01') DESC
    `;

      const [results] = await db.query(query, [user_id, user_id, user_id]);

      console.log(
        `✅ Fetched ${results.length} conversations for user ${user_id}`,
      );

      return res.status(200).json({
        success: true,
        conversations: results,
      });
    } catch (error) {
      console.error("❌ Error fetching conversations:", error);
      return res.status(500).json({
        success: false,
        error: "Server error",
        message: error.message,
      });
    }
  }

  /**
   * Create new conversation
   */
  static async createConversation(req, res) {
    try {
      const { userId, target_user_id, color, node_id, node_type } = req.body;

      console.log(`🟢 [POST] /conversations/create`, req.body);

      // Validate required fields
      if (!userId || !target_user_id) {
        return res.status(400).json({
          success: false,
          error: "User ID and Target User ID are required",
        });
      }

      // Ensure target_user_id is a number
      const targetUserId = parseInt(target_user_id);
      if (isNaN(targetUserId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid target user ID",
        });
      }

      // Check if conversation already exists
      const [existingConv] = await db.query(
        `
        SELECT c.conversation_id 
        FROM conversations c
        INNER JOIN conversations_users cu1 ON c.conversation_id = cu1.conversation_id
        INNER JOIN conversations_users cu2 ON c.conversation_id = cu2.conversation_id
        WHERE cu1.user_id = ? AND cu2.user_id = ?
          AND cu1.deleted = '0' AND cu2.deleted = '0'
        LIMIT 1
      `,
        [userId, targetUserId],
      );

      if (existingConv.length > 0) {
        // Restore if deleted
        await db.query(
          `
          UPDATE conversations_users 
          SET deleted = '0' 
          WHERE conversation_id = ? AND user_id IN (?, ?)
        `,
          [existingConv[0].conversation_id, userId, targetUserId],
        );

        // Get conversation details
        const [conversation] = await db.query(
          `
          SELECT 
            c.*,
            u.user_id as other_user_id,
            u.user_name,
            u.user_picture,
            u.user_verified,
            u.user_firstname,
            u.user_lastname
          FROM conversations c
          INNER JOIN conversations_users cu ON c.conversation_id = cu.conversation_id
          INNER JOIN users u ON cu.user_id = u.user_id
          WHERE c.conversation_id = ? AND cu.user_id = ?
        `,
          [existingConv[0].conversation_id, targetUserId],
        );

        return res.status(200).json({
          success: true,
          conversation: conversation[0] || {
            conversation_id: existingConv[0].conversation_id,
          },
          message: "Conversation restored",
        });
      }

      // Create new conversation
      const [conversationResult] = await db.query(
        "INSERT INTO conversations (last_message_id, color, node_id, node_type) VALUES (0, ?, ?, ?)",
        [color, node_id, node_type],
      );

      const conversationId = conversationResult.insertId;

      // Add both users to conversation
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        // Insert current user
        await connection.query(
          `
          INSERT INTO conversations_users 
          (conversation_id, user_id, seen, typing, deleted) 
          VALUES (?, ?, '0', '0', '0')
        `,
          [conversationId, userId],
        );

        // Insert target user
        await connection.query(
          `
          INSERT INTO conversations_users 
          (conversation_id, user_id, seen, typing, deleted) 
          VALUES (?, ?, '0', '0', '0')
        `,
          [conversationId, targetUserId],
        );

        await connection.commit();

        // Get conversation details with other user info
        const [conversation] = await db.query(
          `
          SELECT 
            c.conversation_id,
            c.last_message_id,
            c.color,
            c.node_id,
            c.node_type,
            cu.user_id as other_user_id,
            u.user_name,
            u.user_picture,
            u.user_verified,
            u.user_firstname,
            u.user_lastname
          FROM conversations c
          INNER JOIN conversations_users cu ON c.conversation_id = cu.conversation_id
          INNER JOIN users u ON cu.user_id = u.user_id
          WHERE c.conversation_id = ? AND cu.user_id = ?
        `,
          [conversationId, targetUserId],
        );

        console.log(
          `✅ Created new conversation ${conversationId} between ${userId} and ${targetUserId}`,
        );

        return res.status(201).json({
          success: true,
          conversation: conversation[0],
          conversationId,
          message: "Conversation created successfully",
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error("❌ Error creating conversation:", error);
      return res.status(500).json({
        success: false,
        error: "Server error",
        message: error.message,
        details: error.code,
      });
    }
  }

  /**
   * Get conversation messages
   */
  static async getConversationMessages(req, res) {
    const { conversation_id } = req.params;
    const { limit = 50, offset = 0 } = req.query;
    const user_id = req.user?.user_id || req.user?.id;

    console.log(`🟢 [GET] /conversations/${conversation_id}/messages`, {
      conversation_id,
      user_id,
      req_user: req.user,
      limit,
      offset,
    });

    try {
      // Check if user is part of conversation
      const [check] = await db.query(
        `
        SELECT 1 FROM conversations_users 
        WHERE conversation_id = ? AND user_id = ? AND deleted = '0'
      `,
        [conversation_id, user_id],
      );

      if (check.length === 0) {
        console.log(
          `❌ User ${user_id} not found in conversation ${conversation_id}`,
        );
        // Instead of 403, try to find what's in the table for debugging
        const [allUsers] = await db.query(
          `
          SELECT user_id, deleted FROM conversations_users
          WHERE conversation_id = ?
        `,
          [conversation_id],
        );
        console.log("Users in conversation:", allUsers);

        return res.status(403).json({
          success: false,
          error: "Access denied - User not part of this conversation",
          debug: {
            user_id,
            conversation_id,
            usersInConversation: allUsers,
          },
        });
      }

      console.log(`✅ User ${user_id} authorized for conversation`);

      // Get messages with user info
      const query = `
        SELECT 
          cm.message_id,
          cm.conversation_id,
          cm.user_id,
          cm.message,
          cm.image,
          cm.voice_note,
          cm.time,
          u.user_id as user_user_id,
          u.user_name,
          u.user_picture,
          u.user_verified,
          u.user_firstname,
          u.user_lastname
        FROM conversations_messages cm
        INNER JOIN users u ON cm.user_id = u.user_id
        WHERE cm.conversation_id = ?
        ORDER BY cm.time DESC
        LIMIT ? OFFSET ?
      `;

      const [messages] = await db.query(query, [
        conversation_id,
        parseInt(limit),
        parseInt(offset),
      ]);

      // Mark messages as seen for this user
      await db.query(
        `
        UPDATE conversations_users 
        SET seen = '1' 
        WHERE conversation_id = ? AND user_id = ?
      `,
        [conversation_id, user_id],
      );

      // Get conversation users
      const [users] = await db.query(
        `
        SELECT 
          cu.id,
          cu.conversation_id,
          cu.user_id,
          cu.seen,
          cu.typing,
          cu.deleted,
          u.user_name,
          u.user_picture,
          u.user_verified,
          u.user_firstname,
          u.user_lastname
        FROM conversations_users cu
        INNER JOIN users u ON cu.user_id = u.user_id
        WHERE cu.conversation_id = ? AND cu.deleted = '0'
      `,
        [conversation_id],
      );

      console.log(`✅ Fetched ${messages.length} messages`);

      return res.status(200).json({
        success: true,
        messages: messages.reverse(), // Chronological order
        users,
        conversationId: conversation_id,
        hasMore: messages.length === parseInt(limit),
      });
    } catch (error) {
      console.error("❌ Error fetching messages:", error);
      return res.status(500).json({
        success: false,
        error: "Server error",
        message: error.message,
      });
    }
  }

  /**
   * Send message
   */
  static async sendMessage(req, res) {
    // Get conversation_id from params
    const { conversation_id } = req.params;
    const { message } = req.body; // Only message from body
    const user_id = req.user?.user_id || req.user?.id;
    const file = req.file; // Get uploaded file

    console.log("🔍 [DEBUG] sendMessage called with:");
    console.log("  - conversation_id:", conversation_id);
    console.log("  - user_id:", user_id);
    console.log("  - message:", message);
    console.log("  - file object:", file);
    console.log("  - file mimetype:", file?.mimetype);
    console.log("  - file path:", file?.path);

    // Check if conversation_id is valid
    if (
      !conversation_id ||
      conversation_id === "undefined" ||
      conversation_id === "null"
    ) {
      console.error("❌ Invalid conversation_id:", conversation_id);
      return res.status(400).json({
        success: false,
        error: "Valid Conversation ID is required",
        received_id: conversation_id,
      });
    }

    // Check if we have content (message OR file)
    if (!message && !file) {
      return res.status(400).json({
        success: false,
        error: "Message or media is required",
      });
    }

    try {
      // Check if user is part of conversation
      const [check] = await db.query(
        `SELECT 1 FROM conversations_users 
       WHERE conversation_id = ? AND user_id = ? AND deleted = '0'`,
        [conversation_id, user_id],
      );

      if (check.length === 0) {
        return res.status(403).json({
          success: false,
          error: "Access denied",
        });
      }

      let imagePath = null;
      let voiceNotePath = null;

      // Handle uploaded file - FIXED VERSION
      if (file && file.path) {
        // Determine destination path
        const isImage = file.mimetype.startsWith("image/");
        const isVideo = file.mimetype.startsWith("video/");
        const isAudio = file.mimetype.startsWith("audio/");

        try {
          // Get the relative path from uploads directory
          let relativePath = file.path;

          // Only try to replace if path exists
          if (relativePath) {
            relativePath = relativePath
              .replace(process.cwd(), "")
              .replace(/\\/g, "/"); // Use replace instead of replaceAll for compatibility

            if (relativePath.startsWith("/")) {
              relativePath = relativePath.substring(1);
            }
          }

          if (isImage || isVideo) {
            // Images and videos go in 'image' field
            imagePath = relativePath;
            console.log(
              `✅ Media uploaded to: ${imagePath} (${isVideo ? "video" : "image"})`,
            );
          } else if (isAudio) {
            // Audio files go in 'voice_note' field
            voiceNotePath = relativePath;
            console.log(`✅ Voice note uploaded to: ${voiceNotePath}`);
          } else {
            console.warn(`⚠️ Unknown file type: ${file.mimetype}`);
          }
        } catch (pathError) {
          console.error("❌ Error processing file path:", pathError);
          // Don't fail the entire request if path processing fails
          // Just log it and continue with null paths
        }
      } else if (file) {
        console.warn("⚠️ File object exists but no path property:", file);
      }

      // Insert message
      const query = `
      INSERT INTO conversations_messages 
      (conversation_id, user_id, message, image, voice_note, time) 
      VALUES (?, ?, ?, ?, ?, NOW())
    `;

      const [result] = await db.query(query, [
        conversation_id,
        user_id,
        message || "", // Use message from body or empty string
        imagePath, // Can be null
        voiceNotePath, // Can be null
      ]);

      const messageId = result.insertId;

      // Update conversation's last message
      await db.query(
        `UPDATE conversations 
       SET last_message_id = ? 
       WHERE conversation_id = ?`,
        [messageId, conversation_id],
      );

      // Update seen status for sender
      await db.query(
        `UPDATE conversations_users 
       SET seen = '1' 
       WHERE conversation_id = ? AND user_id = ?`,
        [conversation_id, user_id],
      );

      // Get full message with user info
      const [messageWithUser] = await db.query(
        `SELECT 
        cm.message_id,
        cm.conversation_id,
        cm.user_id,
        cm.message,
        cm.image,
        cm.voice_note,
        cm.time,
        u.user_name,
        u.user_picture,
        u.user_verified,
        u.user_firstname,
        u.user_lastname
       FROM conversations_messages cm
       INNER JOIN users u ON cm.user_id = u.user_id
       WHERE cm.message_id = ?`,
        [messageId],
      );

      // Get other users in conversation for notification
      const [otherUsers] = await db.query(
        `SELECT user_id 
       FROM conversations_users 
       WHERE conversation_id = ? AND user_id != ? AND deleted = '0'`,
        [conversation_id, user_id],
      );

      // ✅ Create notifications for other users in the conversation
      for (const otherUser of otherUsers) {
        // Get sender details for notification
        const [senderRows] = await db.query(
          `SELECT user_firstname, user_lastname, user_name FROM users WHERE user_id = ?`,
          [user_id],
        );
        const senderName = senderRows[0]
          ? `${senderRows[0].user_firstname || ""} ${senderRows[0].user_lastname || ""}`.trim() ||
            senderRows[0].user_name
          : "Someone";

        await NotificationService.createNotification(
          otherUser.user_id,
          user_id,
          "message_received",
          messageData.message
            ? `${senderName}: ${messageData.message.substring(0, 50)}`
            : `${senderName} sent a message`,
          "message",
          messageId,
          `/messages/${conversation_id}`,
        );
      }

      console.log(`✅ Message sent successfully (ID: ${messageId})`);

      return res.status(201).json({
        success: true,
        message: messageWithUser[0],
        otherUsers: otherUsers.map((u) => u.user_id),
      });
    } catch (error) {
      console.error("❌ Error sending message:", error);
      console.error("Stack trace:", error.stack);

      // Clean up uploaded file if something went wrong
      if (req.file && req.file.path) {
        try {
          const fs = require("fs");
          if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
            console.log(`🗑️ Cleaned up file: ${req.file.path}`);
          }
        } catch (cleanupError) {
          console.error("Failed to cleanup file:", cleanupError);
        }
      }

      return res.status(500).json({
        success: false,
        error: "Server error",
        message: error.message,
        details: error.stack,
      });
    }
  }

  /**
   * Mark messages as seen
   */
  static async markMessagesAsSeen(req, res) {
    const { conversation_id } = req.params;
    const user_id = req.user?.user_id || req.user?.id;

    console.log(`🟢 [PUT] /conversations/${conversation_id}/seen`);

    try {
      // Update both seen status and last_seen_time
      await db.query(
        `
      UPDATE conversations_users 
      SET seen = '1', last_seen_time = NOW() 
      WHERE conversation_id = ? AND user_id = ?
      `,
        [conversation_id, user_id],
      );

      // Get last message ID
      const [lastMessage] = await db.query(
        `
      SELECT last_message_id 
      FROM conversations 
      WHERE conversation_id = ?
      `,
        [conversation_id],
      );

      console.log(`✅ Messages marked as seen for user ${user_id}`);

      return res.status(200).json({
        success: true,
        lastMessageId: lastMessage[0]?.last_message_id || null,
        lastSeenTime: new Date().toISOString(),
      });
    } catch (error) {
      console.error("❌ Error marking messages as seen:", error);
      return res.status(500).json({
        success: false,
        error: "Server error",
      });
    }
  }

  /**
   * Update typing status
   */
  static async updateTypingStatus(req, res) {
    const { conversation_id } = req.params;
    const { is_typing } = req.body;
    const user_id = req.user?.user_id || req.user?.id;

    console.log(`🟢 [PUT] /conversations/${conversation_id}/typing`);

    try {
      await db.query(
        `
      UPDATE conversations_users 
      SET typing = ? 
      WHERE conversation_id = ? AND user_id = ?
      `,
        [is_typing ? "1" : "0", conversation_id, user_id],
      );

      // Also update typing_time for better tracking
      if (is_typing) {
        await db.query(
          `
        UPDATE conversations_users 
        SET typing_time = NOW() 
        WHERE conversation_id = ? AND user_id = ?
        `,
          [conversation_id, user_id],
        );
      }

      console.log(`✅ Typing status updated: ${is_typing}`);

      return res.status(200).json({
        success: true,
        is_typing,
      });
    } catch (error) {
      console.error("❌ Error updating typing status:", error);
      return res.status(500).json({
        success: false,
        error: "Server error",
      });
    }
  }

  /**
   * Delete conversation (soft delete)
   */
  static async deleteConversation(req, res) {
    const { conversation_id } = req.params;
    const user_id = req.user?.user_id || req.user?.id;

    console.log(`🟢 [DELETE] /conversations/${conversation_id}`);

    try {
      // Mark as deleted for this user
      await db.query(
        `
        UPDATE conversations_users 
        SET deleted = '1' 
        WHERE conversation_id = ? AND user_id = ?
      `,
        [conversation_id, user_id],
      );

      console.log(`✅ Conversation deleted for user ${user_id}`);

      return res.status(200).json({
        success: true,
        message: "Conversation deleted",
      });
    } catch (error) {
      console.error("❌ Error deleting conversation:", error);
      return res.status(500).json({
        success: false,
        error: "Server error",
      });
    }
  }

  /**
   * Get unread message count (using last_seen_time)
   */
  static async getUnreadCount(req, res) {
    const user_id = req.user?.user_id || req.user?.id;

    console.log(`🟢 [GET] /conversations/unread/count`);

    try {
      const [result] = await db.query(
        `
      SELECT 
        COUNT(DISTINCT c.conversation_id) as unread_conversations,
        COALESCE(SUM(unread_counts.unread_count), 0) as total_unread_messages
      FROM conversations_users cu
      INNER JOIN conversations c ON cu.conversation_id = c.conversation_id
      LEFT JOIN (
        SELECT 
          cm.conversation_id,
          COUNT(*) as unread_count
        FROM conversations_messages cm
        WHERE cm.user_id != ?
          AND cm.time > COALESCE(
            (
              SELECT cu2.last_seen_time 
              FROM conversations_users cu2 
              WHERE cu2.conversation_id = cm.conversation_id 
                AND cu2.user_id = ?
            ), '2000-01-01'
          )
        GROUP BY cm.conversation_id
      ) as unread_counts ON c.conversation_id = unread_counts.conversation_id
      WHERE cu.user_id = ? 
        AND cu.deleted = '0'
        AND unread_counts.unread_count > 0
      `,
        [user_id, user_id, user_id],
      );

      const counts = result[0] || {
        unread_conversations: 0,
        total_unread_messages: 0,
      };

      console.log(
        `✅ Unread counts: ${counts.total_unread_messages} messages in ${counts.unread_conversations} conversations`,
      );

      return res.status(200).json({
        success: true,
        ...counts,
      });
    } catch (error) {
      console.error("❌ Error fetching unread count:", error);
      return res.status(500).json({
        success: false,
        error: "Server error",
        message: error.message,
      });
    }
  }

  /**
   * Search messages in conversation
   */
  static async searchMessages(req, res) {
    const { conversation_id } = req.params;
    const { query } = req.query;
    const user_id = req.user?.user_id || req.user?.id;

    console.log(`🟢 [GET] /conversations/${conversation_id}/search`);

    try {
      // Verify user has access to conversation
      const [accessCheck] = await db.query(
        `
        SELECT 1 FROM conversations_users 
        WHERE conversation_id = ? AND user_id = ? AND deleted = '0'
      `,
        [conversation_id, user_id],
      );

      if (accessCheck.length === 0) {
        return res.status(403).json({
          success: false,
          error: "Access denied",
        });
      }

      const [messages] = await db.query(
        `
        SELECT 
          cm.message_id,
          cm.conversation_id,
          cm.user_id,
          cm.message,
          cm.image,
          cm.voice_note,
          cm.time,
          u.user_name,
          u.user_picture,
          u.user_verified,
          u.user_firstname,
          u.user_lastname
        FROM conversations_messages cm
        INNER JOIN users u ON cm.user_id = u.user_id
        WHERE cm.conversation_id = ?
          AND (cm.message LIKE ? OR u.user_name LIKE ?)
        ORDER BY cm.time DESC
        LIMIT 50
      `,
        [conversation_id, `%${query}%`, `%${query}%`],
      );

      console.log(`✅ Found ${messages.length} messages matching "${query}"`);

      return res.status(200).json({
        success: true,
        messages,
        query,
      });
    } catch (error) {
      console.error("❌ Error searching messages:", error);
      return res.status(500).json({
        success: false,
        error: "Server error",
        message: error.message,
      });
    }
  }

  /**
   * Get conversation with specific user
   */
  static async getConversationWithUser(req, res) {
    const { target_user_id } = req.params;
    const user_id = req.user?.user_id || req.user?.id;

    console.log(`🟢 [GET] /conversations/with/${target_user_id}`, {
      user_id,
      target_user_id,
      req_user: req.user,
    });

    try {
      const [conversation] = await db.query(
        `
        SELECT c.conversation_id
        FROM conversations c
        INNER JOIN conversations_users cu1 ON c.conversation_id = cu1.conversation_id
        INNER JOIN conversations_users cu2 ON c.conversation_id = cu2.conversation_id
        WHERE cu1.user_id = ? AND cu2.user_id = ?
          AND cu1.deleted = '0' AND cu2.deleted = '0'
        LIMIT 1
      `,
        [user_id, target_user_id],
      );

      if (conversation.length === 0) {
        console.log("ℹ️ No conversation found between users");
        return res.status(200).json({
          success: true,
          exists: false,
          conversation: null,
          message: "No conversation found",
        });
      }

      console.log("✅ Conversation found:", conversation[0].conversation_id);

      return res.status(200).json({
        success: true,
        exists: true,
        conversation: {
          conversation_id: conversation[0].conversation_id,
        },
        conversationId: conversation[0].conversation_id,
      });
    } catch (error) {
      console.error("❌ Error finding conversation:", error);
      return res.status(500).json({
        success: false,
        error: "Server error",
        message: error.message,
      });
    }
  }
}

module.exports = ChatController;
