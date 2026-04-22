// controllers/callController.js
const db = require("../config/db");
const { v4: uuidv4 } = require("uuid");
const fcmService = require("../services/fcmService");

// Initialize call
// Add this to your callController.js
const { io } = require("../index"); // Import the io instance

// Modify your initiateCall function to emit a call event
const initiateCall = async (req, res) => {
  const { from_user_id, to_user_id } = req.body;

  try {
    // Verify users exist
    const [fromUser] = await db.query(
      "SELECT user_id FROM users WHERE user_id = ?",
      [from_user_id],
    );
    const [toUser] = await db.query(
      "SELECT user_id FROM users WHERE user_id = ?",
      [to_user_id],
    );

    if (!fromUser.length || !toUser.length) {
      return res.status(404).json({ error: "User not found" });
    }

    const roomId = uuidv4().replace(/-/g, "").substring(0, 32);

    // Insert call record using just user IDs
    const [result] = await db.query(
      `INSERT INTO conversations_calls_audio 
       (from_user_id, to_user_id, room, created_time)
       VALUES (?, ?, ?, NOW())`,
      [from_user_id, to_user_id, roomId],
    );

    // Emit to recipient using their user_id as the room identifier
    io.to(`user_${to_user_id}`).emit("incoming-call", {
      call_id: result.insertId,
      room_id: roomId,
      from_user_id,
    });

    // Send push notification for incoming call
    await fcmService.sendIncomingCallPush(to_user_id, {
      title: "Incoming Call",
      body: "You have an incoming call",
      data: {
        type: "incoming_call",
        call_id: result.insertId,
        room_id: roomId,
        from_user_id,
      },
    });

    return res.status(201).json({
      call_id: result.insertId,
      room_id: roomId,
      message: "Call initiated",
    });
  } catch (error) {
    console.error("Error initiating call:", error);
    return res.status(500).json({ error: "Failed to initiate call" });
  }
};

// Update call status
const updateCallStatus = async (req, res) => {
  const { call_id, answered, declined } = req.body;

  try {
    await db.query(
      `UPDATE conversations_calls_audio 
       SET answered = ?, declined = ?, updated_time = NOW()
       WHERE call_id = ?`,
      [answered, declined, call_id],
    );

    return res.status(200).json({ message: "Call status updated" });
  } catch (error) {
    console.error("Error updating call status:", error);
    return res.status(500).json({ error: "Failed to update call status" });
  }
};

// End call
const endCall = async (req, res) => {
  const { call_id } = req.body;

  try {
    await db.query(
      `UPDATE conversations_calls_audio 
       SET updated_time = NOW()
       WHERE call_id = ?`,
      [call_id],
    );

    return res.status(200).json({ message: "Call ended" });
  } catch (error) {
    console.error("Error ending call:", error);
    return res.status(500).json({ error: "Failed to end call" });
  }
};

module.exports = {
  initiateCall,
  updateCallStatus,
  endCall,
};
