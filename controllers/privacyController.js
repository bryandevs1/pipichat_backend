const db = require("../config/db");

// Get user privacy settings
exports.getPrivacySettings = async (req, res) => {
  const { user_id } = req.params;
  console.log(`[INFO] Fetching privacy settings for user_id: ${user_id}`);

  try {
    const [rows] = await db.query(
      "SELECT user_chat_enabled, user_newsletter_enabled, user_privacy_poke, user_privacy_gifts, user_privacy_wall, user_privacy_gender, user_privacy_birthdate, user_privacy_relationship, user_privacy_basic, user_privacy_work, user_privacy_location, user_privacy_education, user_privacy_other, user_privacy_friends, user_privacy_followers, user_privacy_photos, user_privacy_pages, user_privacy_groups, user_privacy_events, user_privacy_subscriptions FROM users WHERE user_id = ?",
      [user_id]
    );

    if (rows.length === 0) {
      console.warn(`[WARNING] User with ID ${user_id} not found.`);
      return res.status(404).json({ success: false, message: "User not found" });
    }

    console.log(`[INFO] Privacy settings fetched successfully for user_id: ${user_id}`, rows[0]);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error(`[ERROR] Failed to fetch privacy settings for user_id: ${user_id}`, error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Update user privacy settings
// Update user privacy settings - FULLY FIXED VERSION
exports.updatePrivacySettings = async (req, res) => {
  const { user_id } = req.params;
  const updates = req.body;

  console.log(`[INFO] Updating privacy settings for user_id: ${user_id} with updates:`, updates);

  const allowedPrivacyValues = ['me', 'friends', 'public'];
  
  const privacyFields = [
    "user_privacy_poke", "user_privacy_gifts", "user_privacy_wall",
    "user_privacy_gender", "user_privacy_birthdate", "user_privacy_relationship",
    "user_privacy_basic", "user_privacy_work", "user_privacy_location",
    "user_privacy_education", "user_privacy_other", "user_privacy_friends",
    "user_privacy_followers", "user_privacy_photos", "user_privacy_pages",
    "user_privacy_groups", "user_privacy_events", "user_privacy_subscriptions",
  ];

  const booleanFields = ["user_chat_enabled", "user_newsletter_enabled"];

  const invalidFields = [];
  const finalUpdates = { ...updates }; // Clone so we don't mutate original
  const updateKeys = [];

  // Validate and normalize values
  Object.keys(updates).forEach(key => {
    if (privacyFields.includes(key)) {
      if (allowedPrivacyValues.includes(updates[key])) {
        finalUpdates[key] = updates[key]; // already valid
        updateKeys.push(key);
      } else {
        invalidFields.push({ field: key, value: updates[key], allowed: allowedPrivacyValues });
      }
    } else if (booleanFields.includes(key)) {
      // Properly convert to '1' or '0' string
      const boolValue = updates[key] === true || updates[key] === '1' || updates[key] === 1;
      finalUpdates[key] = boolValue ? '1' : '0';
      updateKeys.push(key);
    }
  });

  if (invalidFields.length > 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid privacy values provided",
      invalidFields
    });
  }

  if (updateKeys.length === 0) {
    return res.status(400).json({ success: false, message: "No valid fields to update" });
  }

  try {
    const setClause = updateKeys.map(k => `${k} = ?`).join(", ");
    const values = updateKeys.map(k => finalUpdates[k]); // Use normalized values!

    console.log(`[INFO] Executing SQL: UPDATE users SET ${setClause} WHERE user_id = ?`, [...values, user_id]);

    const [result] = await db.query(
      `UPDATE users SET ${setClause} WHERE user_id = ?`,
      [...values, user_id]
    );

    console.log(`[INFO] Update result:`, result);

    // Always return success + fresh data (even if no rows changed)
    const [freshRows] = await db.query(
      `SELECT user_chat_enabled, user_newsletter_enabled, user_privacy_poke, user_privacy_gifts, 
       user_privacy_wall, user_privacy_gender, user_privacy_birthdate, user_privacy_relationship, 
       user_privacy_basic, user_privacy_work, user_privacy_location, user_privacy_education, 
       user_privacy_other, user_privacy_friends, user_privacy_followers, user_privacy_photos, 
       user_privacy_pages, user_privacy_groups, user_privacy_events, user_privacy_subscriptions 
       FROM users WHERE user_id = ?`,
      [user_id]
    );

    if (freshRows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    console.log(`[SUCCESS] Privacy settings saved for user_id: ${user_id}`);
    
    res.json({
      success: true,
      message: "Privacy settings saved successfully",
      data: freshRows[0]
    });

  } catch (error) {
    console.error(`[ERROR] Update failed for user_id: ${user_id}`, error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};  