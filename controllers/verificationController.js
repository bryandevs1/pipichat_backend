const db = require("../config/db"); // Import your database connection
const multer = require("multer"); // For handling file uploads
const { uploadToGoogleCloud } = require("../utils/googleCloud"); // Import Google Cloud upload function

// Configure multer for file uploads (store files temporarily before upload)
const storage = multer.memoryStorage();
const upload = multer({ storage }).fields([
  { name: "photo", maxCount: 1 },
  { name: "passport", maxCount: 1 },
]);

const createVerificationRequest = async (req, res) => {
  console.log("🔹 Received verification request");

  upload(req, res, async (err) => {
    if (err) {
      console.error("❌ Multer error:", err);
      return res.status(400).json({
        success: false,
        message: "File upload failed.",
      });
    }

    console.log("✅ File upload successful, processing request...");

    const { node_id, node_type, message } = req.body;
    const photoFile = req.files["photo"] ? req.files["photo"][0] : null;
    const passportFile = req.files["passport"]
      ? req.files["passport"][0]
      : null;

    console.log("📌 Request body received:", req.body);
    console.log("📷 Uploaded files:", {
      photo: photoFile ? photoFile.originalname : "No photo",
      passport: passportFile ? passportFile.originalname : "No passport",
    });

    // Check required fields
    if (!node_id || !node_type) {
      console.error("❌ Missing required fields: node_id or node_type");
      return res.status(400).json({
        success: false,
        message: "node_id and node_type are required fields.",
      });
    }

    try {
      let photoUrl = null;
      let passportUrl = null;

      // Upload photo to Google Cloud if it exists
      if (photoFile) {
        console.log("⏳ Uploading photo to Google Cloud...");
        photoUrl = await uploadToGoogleCloud(
          photoFile,
          "uploads/verification_photos"
        );
        console.log("✅ Photo uploaded:", photoUrl);
      }

      // Upload passport to Google Cloud if it exists
      if (passportFile) {
        console.log("⏳ Uploading passport to Google Cloud...");
        passportUrl = await uploadToGoogleCloud(
          passportFile,
          "uploads/verification_passports"
        );
        console.log("✅ Passport uploaded:", passportUrl);
      }

      // Extract only the URL string for database insertion
      const photoUrlString = photoUrl?.url || null;
      const passportUrlString = passportUrl?.url || null;

      console.log(
        "📌 Preparing to save verification request to database with:"
      );
      console.log({
        node_id,
        node_type,
        photo: photoUrlString,
        passport: passportUrlString,
        message: message || "No message provided",
        status: 0,
      });

      // Save verification request to the database
      const [result] = await db.query(
        `INSERT INTO verification_requests (
          node_id,
          node_type,
          photo,
          passport,
          message,
          time,
          status
        ) VALUES (?, ?, ?, ?, ?, NOW(), 0)`,
        [node_id, node_type, photoUrlString, passportUrlString, message || null]
      );

      if (result.affectedRows === 1) {
        console.log(
          "✅ Verification request successfully stored in DB with ID:",
          result.insertId
        );
        return res.json({
          success: true,
          message: "Verification request submitted successfully.",
          request_id: result.insertId,
        });
      } else {
        console.error("❌ Database insertion failed.");
        return res.status(500).json({
          success: false,
          message: "Failed to submit verification request.",
        });
      }
    } catch (error) {
      console.error("❌ Error creating verification request:", error);
      return res.status(500).json({
        success: false,
        message: "Server error while processing the request.",
      });
    }
  });
};

const checkVerificationStatus = async (req, res) => {
  try {
    const { user_id } = req.params;
    console.log(`🟢 Received request to check verification status for user_id: ${user_id}`);

    // Query database for the user's verification status
    const [rows] = await db.query(
      "SELECT status FROM verification_requests WHERE node_id = ? ORDER BY time DESC LIMIT 1",
      [user_id]
    );

    console.log(`🔍 Query Result:`, rows);

    if (rows.length === 0) {
      console.log(`⚠️ No verification request found for user_id: ${user_id}`);
      return res.status(200).json({ success: true, status: "not_requested" });
    }

    const status = rows[0].status;
    let message = "";

    if (status === 0) {
      message = "pending";
    } else if (status === 1) {
      message = "verified";
    } else if (status === -1) {
      message = "rejected";
    }

    console.log(`✅ Returning status for user_id ${user_id}: ${message}`);
    return res.status(200).json({ success: true, status: message });

  } catch (error) {
    console.error(`❌ Error checking verification status for user_id: ${req.params.user_id}`, error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

module.exports = { createVerificationRequest, checkVerificationStatus };
