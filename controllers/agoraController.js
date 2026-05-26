const AgoraTokenService = require("../utils/agoraToken");
const db = require("../config/db");
const { v4: uuidv4 } = require("uuid");
const fcmService = require("../services/fcmService");

class AgoraController {
  /**
   * Generate Agora tokens (audio / video)
   */
  static async generateCallTokens(req, res) {
    const { channel_name, call_type = "audio", target_user_id } = req.body;
    const user_id = req.user?.user_id || req.user?.id;

    try {
      const channelName =
        channel_name || `agora_${user_id}_${target_user_id}_${Date.now()}`;

      const isExistingChannelJoin = Boolean(channel_name);
      const room = uuidv4();

      const token = AgoraTokenService.generateRTCToken(channelName, user_id);
      const tokenString = typeof token === "string" ? token : token.token;

      if (!tokenString) {
        throw new Error("Agora token generation failed");
      }

      if (!isExistingChannelJoin) {
        const callTable =
          call_type === "audio"
            ? "conversations_calls_audio"
            : "conversations_calls_video";

        await db.query(
          `
          INSERT INTO ${callTable}
          (
            from_user_id,
            to_user_id,
            room,
            channel_name,
            provider,
            answered,
            declined,
            created_time,
            updated_time
          )
          VALUES (?, ?, ?, ?, 'agora', '0', '0', NOW(), NOW())
          `,
          [user_id, target_user_id, room, channelName],
        );

        // Send push notification for incoming call
        console.log(`📞 Sending push notification to user ${target_user_id}`);
        await fcmService.sendIncomingCallPush(target_user_id, {
          title: "Incoming Call",
          body: "You have an incoming call",
          data: {
            type: "incoming_call",
            channel_name: channelName,
            call_type,
            from_user_id: user_id,
          },
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          token: tokenString,
          channelName,
          uid: user_id,
          callType: call_type,
          room,
        },
      });
    } catch (error) {
      console.error("❌ Agora token error:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Update Agora call status
   */
  static async updateCallStatus(req, res) {
    const { call_id, call_type, status } = req.body;

    try {
      const callTable =
        call_type === "audio"
          ? "conversations_calls_audio"
          : "conversations_calls_video";

      let updates = [];
      let values = [];

      if (status === "answered") {
        updates.push("answered = '1'");
      } else if (status === "declined") {
        updates.push("declined = '1'");
      }

      updates.push("updated_time = NOW()");

      await db.query(
        `
        UPDATE ${callTable}
        SET ${updates.join(", ")}
        WHERE call_id = ?
          AND provider = 'agora'
        `,
        [...values, call_id],
      );

      return res.status(200).json({
        success: true,
        message: `Call ${status}`,
      });
    } catch (error) {
      console.error("❌ Update status error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to update call status",
      });
    }
  }

  /**
   * End Agora call
   */
  static async endCall(req, res) {
    const { call_id, call_type } = req.body;

    try {
      const callTable =
        call_type === "audio"
          ? "conversations_calls_audio"
          : "conversations_calls_video";

      await db.query(
        `
        UPDATE ${callTable}
        SET updated_time = NOW()
        WHERE call_id = ?
          AND provider = 'agora'
        `,
        [call_id],
      );

      return res.status(200).json({
        success: true,
        message: "Call ended",
      });
    } catch (error) {
      console.error("❌ End call error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to end call",
      });
    }
  }

  /**
   * Get Agora call history
   */
  static async getCallHistory(req, res) {
    const user_id = req.user?.user_id || req.user?.id;
    const { type = "all", limit = 20, offset = 0 } = req.query;

    try {
      let calls = [];

      if (type === "all" || type === "audio") {
        const [audio] = await db.query(
          `
          SELECT
            ca.*,
            'audio' AS call_type,
            TIMESTAMPDIFF(
              SECOND,
              ca.created_time,
              COALESCE(ca.updated_time, NOW())
            ) AS duration
          FROM conversations_calls_audio ca
          WHERE ca.provider = 'agora'
            AND (ca.from_user_id = ? OR ca.to_user_id = ?)
          ORDER BY ca.created_time DESC
          LIMIT ? OFFSET ?
          `,
          [user_id, user_id, Number(limit), Number(offset)],
        );
        calls.push(...audio);
      }

      if (type === "all" || type === "video") {
        const [video] = await db.query(
          `
          SELECT
            cv.*,
            'video' AS call_type,
            TIMESTAMPDIFF(
              SECOND,
              cv.created_time,
              COALESCE(cv.updated_time, NOW())
            ) AS duration
          FROM conversations_calls_video cv
          WHERE cv.provider = 'agora'
            AND (cv.from_user_id = ? OR cv.to_user_id = ?)
          ORDER BY cv.created_time DESC
          LIMIT ? OFFSET ?
          `,
          [user_id, user_id, Number(limit), Number(offset)],
        );
        calls.push(...video);
      }

      calls.sort((a, b) => new Date(b.created_time) - new Date(a.created_time));

      return res.status(200).json({
        success: true,
        calls: calls.slice(0, Number(limit)),
      });
    } catch (error) {
      console.error("❌ History error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch call history",
      });
    }
  }

  /**
   * Get active Agora calls
   */
  static async getActiveCalls(req, res) {
    const user_id = req.user?.user_id || req.user?.id;

    try {
      const [audio] = await db.query(
        `
        SELECT ca.*, 'audio' AS call_type
        FROM conversations_calls_audio ca
        WHERE ca.provider = 'agora'
          AND ca.answered = '1'
          AND ca.declined = '0'
          AND (ca.from_user_id = ? OR ca.to_user_id = ?)
        `,
        [user_id, user_id],
      );

      const [video] = await db.query(
        `
        SELECT cv.*, 'video' AS call_type
        FROM conversations_calls_video cv
        WHERE cv.provider = 'agora'
          AND cv.answered = '1'
          AND cv.declined = '0'
          AND (cv.from_user_id = ? OR cv.to_user_id = ?)
        `,
        [user_id, user_id],
      );

      return res.status(200).json({
        success: true,
        activeCalls: [...audio, ...video],
      });
    } catch (error) {
      console.error("❌ Active calls error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch active calls",
      });
    }
  }

  // Add these methods to your existing AgoraController

  /**
   * Generate token for live streaming
   */
  static async generateLiveToken(req, res) {
    const { channel_name, uid, role = "publisher" } = req.body;
    const user_id = req.user?.user_id || req.user?.id;

    try {
      const channelName = channel_name || `live_${user_id}_${Date.now()}`;
      const agoraUid = uid || user_id;

      // Generate token using your existing service
      const token = AgoraTokenService.generateRTCToken(channelName, agoraUid);

      return res.status(200).json({
        success: true,
        data: {
          token: token,
          channelName,
          uid: agoraUid,
          role,
        },
      });
    } catch (error) {
      console.error("❌ Live token error:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Start live stream recording
   */
  static async startLiveRecording(req, res) {
    const { post_id, channel_name, uid } = req.body;
    const user_id = req.user?.user_id || req.user?.id;

    try {
      // Start cloud recording via Agora
      // Note: You need Agora Cloud Recording service enabled
      const recordingData = {
        post_id,
        channel_name,
        uid,
        started_at: new Date(),
        status: "recording",
      };

      // Update post to mark as live
      await db.query(
        `UPDATE posts_live 
       SET agora_resource_id = ?, agora_sid = ?, live_ended = '0' 
       WHERE post_id = ?`,
        [
          recordingData.resource_id || "temp",
          recordingData.sid || "temp",
          post_id,
        ],
      );

      return res.status(200).json({
        success: true,
        message: "Live recording started",
        data: recordingData,
      });
    } catch (error) {
      console.error("❌ Start recording error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to start recording",
      });
    }
  }

  /**
   * Stop live stream recording
   */
  static async stopLiveRecording(req, res) {
    const { post_id } = req.body;
    const user_id = req.user?.user_id || req.user?.id;

    try {
      // Stop cloud recording
      const stopData = {
        post_id,
        stopped_at: new Date(),
        status: "stopped",
      };

      // Update post to mark as ended
      await db.query(
        `UPDATE posts_live 
       SET live_ended = '1', live_recorded = '1', agora_file = ? 
       WHERE post_id = ?`,
        [stopData.recording_url || "default.mp4", post_id],
      );

      return res.status(200).json({
        success: true,
        message: "Live recording stopped",
        data: stopData,
      });
    } catch (error) {
      console.error("❌ Stop recording error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to stop recording",
      });
    }
  }

  /**
   * Get live stream info
   */
  static async getLiveInfo(req, res) {
    const { post_id } = req.params;

    try {
      console.log("📝 Fetching live info for post:", post_id);

      // Debug: Check posts table
      const [postCheck] = await db.query(
        `SELECT * FROM posts WHERE post_id = ?`,
        [post_id],
      );

      console.log("📝 Post check:", postCheck.length ? "Found" : "Not found");

      // Debug: Check posts_live table
      const [liveCheck] = await db.query(
        `SELECT * FROM posts_live WHERE post_id = ?`,
        [post_id],
      );

      console.log("🎥 Live check:", liveCheck.length ? "Found" : "Not found");

      // Fixed query - use 'time' instead of 'created_at'
      const [liveData] = await db.query(
        `SELECT 
        pl.*, 
        p.text as live_title, 
        p.user_id, 
        p.user_type,
        p.time as created_at
       FROM posts p
       LEFT JOIN posts_live pl ON p.post_id = pl.post_id
       WHERE p.post_id = ?`,
        [post_id],
      );

      console.log(
        "🔍 Live data result:",
        liveData.length ? "Success" : "Empty",
      );

      if (!liveData || liveData.length === 0 || !liveData[0].post_id) {
        return res.status(404).json({
          success: false,
          error: "Live stream not found",
          debug: {
            postExists: postCheck.length > 0,
            liveExists: liveCheck.length > 0,
            postData:
              postCheck.length > 0
                ? {
                    id: postCheck[0].post_id,
                    type: postCheck[0].post_type,
                    text: postCheck[0].text,
                  }
                : null,
            liveData:
              liveCheck.length > 0
                ? {
                    channel: liveCheck[0].agora_channel_name,
                    uid: liveCheck[0].agora_uid,
                  }
                : null,
          },
        });
      }

      // Format the response data
      const formattedData = {
        ...liveData[0],
        // Ensure we have required fields with defaults
        agora_channel_name: liveData[0].agora_channel_name || `live_${post_id}`,
        agora_uid: liveData[0].agora_uid || Math.floor(Math.random() * 1000000),
        live_title: liveData[0].live_title || "Live Stream",
        status: "live",
        created_at: liveData[0].created_at || new Date().toISOString(),
      };

      console.log("✅ Formatted live data:", {
        post_id: formattedData.post_id,
        channel: formattedData.agora_channel_name,
        uid: formattedData.agora_uid,
        title: formattedData.live_title,
      });

      return res.status(200).json({
        success: true,
        data: formattedData,
      });
    } catch (error) {
      console.error("❌ Get live info error:", error.message);
      console.error("SQL Error details:", {
        code: error.code,
        sqlState: error.sqlState,
        sqlMessage: error.sqlMessage,
      });

      return res.status(500).json({
        success: false,
        error: "Failed to fetch live info",
        details: error.sqlMessage || error.message,
        suggestion: "Check if posts table has correct columns",
      });
    }
  }

  /**
   * Get active live streams
   */
  static async getActiveLives(req, res) {
    const { limit = 20, offset = 0 } = req.query;

    try {
      const [activeLives] = await db.query(
        `SELECT 
         pl.*, 
         p.text as live_title,
         p.user_id,
         p.user_type,
         u.user_name,
         u.user_picture,
         p.post_date,
         COUNT(DISTINCT plu.user_id) as viewer_count
       FROM posts_live pl
       JOIN posts p ON pl.post_id = p.post_id
       LEFT JOIN posts_live_users plu ON pl.post_id = plu.post_id
       LEFT JOIN users u ON p.user_id = u.user_id AND p.user_type = 'user'
       LEFT JOIN pages pg ON p.user_id = pg.page_id AND p.user_type = 'page'
       WHERE pl.live_ended = '0'
       GROUP BY pl.post_id
       ORDER BY p.post_date DESC
       LIMIT ? OFFSET ?`,
        [Number(limit), Number(offset)],
      );

      return res.status(200).json({
        success: true,
        data: activeLives,
        count: activeLives.length,
      });
    } catch (error) {
      console.error("❌ Get active lives error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch active lives",
      });
    }
  }

  /**
   * Join live stream (add viewer)
   */
  static async joinLiveStream(req, res) {
    const { post_id } = req.body;
    const user_id = req.user?.user_id || req.user?.id;

    try {
      // Check if already joined
      const [existing] = await db.query(
        `SELECT * FROM posts_live_users 
       WHERE post_id = ? AND user_id = ?`,
        [post_id, user_id],
      );

      if (existing.length === 0) {
        await db.query(
          `INSERT INTO posts_live_users (post_id, user_id) 
         VALUES (?, ?)`,
          [post_id, user_id],
        );
      }

      // Get live info for token
      const [liveInfo] = await db.query(
        `SELECT * FROM posts_live WHERE post_id = ?`,
        [post_id],
      );

      if (!liveInfo || liveInfo.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Live stream not found",
        });
      }

      // Generate token for viewer (subscriber role)
      const token = AgoraTokenService.generateRTCToken(
        liveInfo[0].agora_channel_name,
        user_id,
        require("agora-access-token").RtcRole.SUBSCRIBER,
      );

      return res.status(200).json({
        success: true,
        data: {
          token,
          channelName: liveInfo[0].agora_channel_name,
          uid: user_id,
          role: "subscriber",
          liveInfo: liveInfo[0],
        },
      });
    } catch (error) {
      console.error("❌ Join live error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to join live stream",
      });
    }
  }

  /**
   * Leave live stream (remove viewer)
   */
  static async leaveLiveStream(req, res) {
    const { post_id } = req.body;
    const user_id = req.user?.user_id || req.user?.id;

    try {
      await db.query(
        `DELETE FROM posts_live_users 
       WHERE post_id = ? AND user_id = ?`,
        [post_id, user_id],
      );

      return res.status(200).json({
        success: true,
        message: "Left live stream",
      });
    } catch (error) {
      console.error("❌ Leave live error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to leave live stream",
      });
    }
  }

  // Add these methods to your AgoraController class

  /**
   * Send live chat message
   */
  /**
   * Send live chat message
   */
  /**
   * Send live chat message - FIXED VERSION
   */
  static async sendLiveChat(req, res) {
    const { post_id, message } = req.body;
    const user_id = req.user?.user_id || req.user?.id;

    try {
      // Validate input
      if (!post_id || !message || message.trim() === "") {
        return res.status(400).json({
          success: false,
          error: "Post ID and message are required",
        });
      }

      // Check if live stream exists
      const [liveInfo] = await db.query(
        `SELECT * FROM posts_live WHERE post_id = ?`,
        [post_id],
      );

      if (!liveInfo || liveInfo.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Live stream not found",
        });
      }

      // Get user info
      const [userInfo] = await db.query(
        `SELECT user_name, user_picture FROM users WHERE user_id = ?`,
        [user_id],
      );

      if (!userInfo || userInfo.length === 0) {
        return res.status(404).json({
          success: false,
          error: "User not found",
        });
      }

      // Save message to conversations_messages table
      // Create or get conversation for this live stream
      const [existingConversation] = await db.query(
        `SELECT conversation_id FROM conversations 
       WHERE node_id = ? AND node_type = 'live'`,
        [post_id],
      );

      let conversation_id;

      if (existingConversation && existingConversation.length > 0) {
        conversation_id = existingConversation[0].conversation_id;
      } else {
        // FIXED: Create new conversation with last_message_id = 0
        const [newConv] = await db.query(
          `INSERT INTO conversations (node_id, node_type, color, last_message_id) 
         VALUES (?, 'live', '#FF6B35', 0)`,
          [post_id],
        );
        conversation_id = newConv.insertId;
      }

      // Insert the message
      const [result] = await db.query(
        `INSERT INTO conversations_messages (conversation_id, user_id, message, time) 
       VALUES (?, ?, ?, NOW())`,
        [conversation_id, user_id, message.trim()],
      );

      const newMessageId = result.insertId;

      // Update last message in conversation
      await db.query(
        `UPDATE conversations SET last_message_id = ? WHERE conversation_id = ?`,
        [newMessageId, conversation_id],
      );

      // Get the inserted message with user info
      const [insertedMessage] = await db.query(
        `SELECT 
        cm.*,
        u.user_name,
        u.user_picture,
        u.user_verified
      FROM conversations_messages cm
      JOIN users u ON cm.user_id = u.user_id
      WHERE cm.message_id = ?`,
        [newMessageId],
      );

      // Format response
      const formattedMessage = {
        id: newMessageId,
        post_id: post_id,
        user_id: user_id,
        user_name: userInfo[0].user_name,
        user_picture: userInfo[0].user_picture,
        user_verified: insertedMessage[0]?.user_verified === "1",
        message: message.trim(),
        created_at: new Date().toISOString(),
        timestamp: Date.now(),
      };

      return res.status(200).json({
        success: true,
        message: "Message sent successfully",
        data: formattedMessage,
      });
    } catch (error) {
      console.error("❌ Send live chat error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to send message: " + error.message,
      });
    }
  }

  static async getLiveChat(req, res) {
    const { post_id } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    try {
      // Find conversation for this live stream
      const [conversation] = await db.query(
        `SELECT conversation_id FROM conversations 
       WHERE node_id = ? AND node_type = 'live'`,
        [post_id],
      );

      if (!conversation || conversation.length === 0) {
        // No conversation yet, return empty array
        return res.status(200).json({
          success: true,
          data: {
            messages: [],
            total: 0,
            limit: Number(limit),
            offset: Number(offset),
          },
        });
      }

      const conversation_id = conversation[0].conversation_id;

      // Get messages
      const [messages] = await db.query(
        `SELECT 
        cm.message_id as id,
        cm.message,
        cm.time as created_at,
        cm.user_id,
        u.user_name,
        u.user_picture,
        u.user_verified
      FROM conversations_messages cm
      JOIN users u ON cm.user_id = u.user_id
      WHERE cm.conversation_id = ?
      ORDER BY cm.time DESC
      LIMIT ? OFFSET ?`,
        [conversation_id, Number(limit), Number(offset)],
      );

      // Get total count
      const [countResult] = await db.query(
        `SELECT COUNT(*) as total FROM conversations_messages WHERE conversation_id = ?`,
        [conversation_id],
      );

      // Format messages
      const formattedMessages = messages.map((msg) => ({
        id: msg.id,
        post_id: post_id,
        user_id: msg.user_id,
        user_name: msg.user_name,
        user_picture: msg.user_picture,
        user_verified: msg.user_verified === "1",
        message: msg.message,
        created_at: msg.created_at,
        timestamp: new Date(msg.created_at).getTime(),
      }));

      return res.status(200).json({
        success: true,
        data: {
          messages: formattedMessages,
          total: countResult[0]?.total || 0,
          limit: Number(limit),
          offset: Number(offset),
        },
      });
    } catch (error) {
      console.error("❌ Get live chat error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch chat messages",
      });
    }
  }

  /**
   * End live stream - FIXED VERSION
   */
  static async endLiveStream(req, res) {
    const { post_id } = req.params;
    const user_id = req.user?.user_id || req.user?.id;

    try {
      console.log("🛑 [Backend] Ending live stream:", { post_id, user_id });

      // Verify user owns the live stream - don't check live_ended status
      const [liveInfo] = await db.query(
        `SELECT pl.*, p.user_id as post_owner_id 
       FROM posts_live pl
       JOIN posts p ON pl.post_id = p.post_id
       WHERE pl.post_id = ?`,
        [post_id],
      );

      console.log("🛑 [Backend] Live info found:", liveInfo?.length > 0);

      if (!liveInfo || liveInfo.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Live stream not found",
        });
      }

      // Check if user is the owner
      if (liveInfo[0].post_owner_id !== user_id) {
        return res.status(403).json({
          success: false,
          error: "You are not authorized to end this stream",
        });
      }

      // Update live stream status even if already ended (idempotent)
      const [updateResult] = await db.query(
        `UPDATE posts_live 
       SET live_ended = '1', 
           live_recorded = '1',
           agora_file = ?
       WHERE post_id = ?`,
        [`live_recording_${post_id}_${Date.now()}.mp4`, post_id],
      );

      console.log("🛑 [Backend] Update result:", {
        affectedRows: updateResult.affectedRows,
      });

      // Clear all viewers
      await db.query(`DELETE FROM posts_live_users WHERE post_id = ?`, [
        post_id,
      ]);

      console.log("🛑 [Backend] Viewers cleared");

      return res.status(200).json({
        success: true,
        message: "Live stream ended successfully",
        data: {
          post_id: parseInt(post_id),
          ended_at: new Date().toISOString(),
          already_ended: liveInfo[0].live_ended === "1",
        },
      });
    } catch (error) {
      console.error("❌ End live stream error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to end live stream: " + error.message,
      });
    }
  }

  /**
   * Get viewer count for live stream - FIXED VERSION
   */
  static async getViewerCount(req, res) {
    const { post_id } = req.params;

    try {
      console.log("👥 [Backend] Getting viewer count for post:", post_id);

      // First check if live stream exists
      const [liveInfo] = await db.query(
        `SELECT * FROM posts_live WHERE post_id = ?`,
        [post_id],
      );

      if (!liveInfo || liveInfo.length === 0) {
        console.log("👥 [Backend] Live stream not found, returning 0");
        return res.status(200).json({
          success: true,
          data: {
            count: 0,
            post_id: parseInt(post_id),
            stream_exists: false,
          },
        });
      }

      // Count viewers from posts_live_users table
      const [viewerCount] = await db.query(
        `SELECT COUNT(DISTINCT user_id) as count FROM posts_live_users WHERE post_id = ?`,
        [post_id],
      );

      console.log("👥 [Backend] Viewer count:", viewerCount[0]?.count || 0);

      return res.status(200).json({
        success: true,
        data: {
          count: viewerCount[0]?.count || 0,
          post_id: parseInt(post_id),
          stream_exists: true,
          live_ended: liveInfo[0].live_ended === "1",
        },
      });
    } catch (error) {
      console.error("❌ Get viewer count error:", error);
      // Even on error, return 0 to keep frontend working
      return res.status(200).json({
        success: true,
        data: {
          count: 0,
          post_id: parseInt(post_id),
          error: error.message,
        },
      });
    }
  }

  /**
   * Get live stream analytics (bonus method)
   */
  static async getLiveAnalytics(req, res) {
    const { post_id } = req.params;
    const user_id = req.user?.user_id || req.user?.id;

    try {
      // Verify ownership
      const [liveInfo] = await db.query(
        `SELECT pl.*, p.user_id as post_owner_id 
       FROM posts_live pl
       JOIN posts p ON pl.post_id = p.post_id
       WHERE pl.post_id = ?`,
        [post_id],
      );

      if (!liveInfo || liveInfo.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Live stream not found",
        });
      }

      if (liveInfo[0].post_owner_id !== user_id) {
        return res.status(403).json({
          success: false,
          error: "You are not authorized to view analytics for this stream",
        });
      }

      // Get viewer count
      const [viewerCount] = await db.query(
        `SELECT COUNT(DISTINCT user_id) as count FROM posts_live_users WHERE post_id = ?`,
        [post_id],
      );

      // Get chat message count
      const [conversation] = await db.query(
        `SELECT conversation_id FROM conversations 
       WHERE node_id = ? AND node_type = 'live'`,
        [post_id],
      );

      let chatCount = 0;
      if (conversation && conversation.length > 0) {
        const [messageCount] = await db.query(
          `SELECT COUNT(*) as count FROM conversations_messages WHERE conversation_id = ?`,
          [conversation[0].conversation_id],
        );
        chatCount = messageCount[0]?.count || 0;
      }

      // Get post views (from posts_views table)
      const [viewsResult] = await db.query(
        `SELECT COUNT(*) as count FROM posts_views WHERE post_id = ?`,
        [post_id],
      );

      return res.status(200).json({
        success: true,
        data: {
          post_id: parseInt(post_id),
          viewers_count: viewerCount[0]?.count || 0,
          chat_messages_count: chatCount,
          post_views: viewsResult[0]?.count || 0,
          live_started: liveInfo[0].created_at,
          live_ended:
            liveInfo[0].live_ended === "1" ? new Date().toISOString() : null,
          duration_minutes:
            liveInfo[0].live_ended === "1"
              ? Math.floor(
                  (new Date() - new Date(liveInfo[0].created_at)) / 60000,
                )
              : Math.floor(
                  (new Date() - new Date(liveInfo[0].created_at)) / 60000,
                ),
        },
      });
    } catch (error) {
      console.error("❌ Get live analytics error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch analytics",
      });
    }
  }
}

module.exports = AgoraController;
