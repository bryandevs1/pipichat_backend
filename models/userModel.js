const pool = require("../config/db");
const crypto = require("crypto");

async function generateVerificationCode(userId) {
  const verificationCode = crypto.randomInt(100000, 999999).toString(); // Generate a 6-digit code

  // Store it in the user table
  await pool.query(
    "UPDATE users SET user_email_verification_code = ? WHERE id = ?",
    [verificationCode, userId],
  );

  return verificationCode;
}

async function getUserById(userId) {
  const result = await pool.query("SELECT * FROM users WHERE user_id = ?", [
    userId,
  ]);
  const user = result[0]; // Ensure that you access the correct element
  return user;
}
async function getUserByIdentifier(identifier) {
  const result = await pool.query(
    "SELECT * FROM users WHERE user_email = ? OR user_name = ? LIMIT 1",
    [identifier, identifier],
  );

  const rows = result[0]; // first array contains rows
  return rows[0] || null; // return first row or null
}

async function updateUserProfile(userId, profileData) {
  const fields = Object.keys(profileData)
    .map((key) => `${key} = ?`)
    .join(", ");
  const values = [...Object.values(profileData), userId];

  // Log the generated query and the values
  console.log(
    "Generated Query:",
    `UPDATE users SET ${fields} WHERE user_id = ?`,
  );
  console.log("Values:", values);

  await pool.query(`UPDATE users SET ${fields} WHERE user_id = ?`, values);
}

// Update user picture
async function updateUserPicture(userId, pictureUrl) {
  try {
    // Update the user with the new picture URL
    const [result] = await pool.query(
      "UPDATE users SET user_picture = ? WHERE user_id = ?",
      [pictureUrl, userId],
    );

    if (result.affectedRows === 0) {
      console.warn("No rows updated. Verify userId exists in the database.");
      return null;
    }

    // Fetch updated user data after updating the profile picture
    const [rows] = await pool.query("SELECT * FROM users WHERE user_id = ?", [
      userId,
    ]);
    return rows[0]; // Return updated user data
  } catch (error) {
    console.error("Error updating user picture:", error);
    throw error; // Throw error for controller to handle
  }
}

async function updateUserCoverPicture(userId, pictureUrl) {
  try {
    // Fetch the last used global user_cover_id and increment it
    const [lastCoverIdRow] = await pool.query(
      "SELECT MAX(user_cover_id) AS lastCoverId FROM users",
    );
    const lastCoverId = lastCoverIdRow[0].lastCoverId || 0; // Default to 0 if no cover exists
    const newCoverId = lastCoverId + 1;

    const [lastCoverAlbumRow] = await pool.query(
      "SELECT MAX(user_album_covers) AS lastaLBUMId FROM users",
    );
    const lastaLBUMId = lastCoverAlbumRow[0].lastaLBUMId || 0; // Default to 0 if no cover exists
    const newAlbumId = lastaLBUMId + 1;

    // Update the user with the new picture URL and globally unique user_cover_id
    const [result] = await pool.query(
      `UPDATE users 
       SET 
         user_cover = ?, 
         user_cover_id = ?, 
         user_album_covers = ?, 
         user_cover_position = '0px'
       WHERE user_id = ?`,
      [pictureUrl, newCoverId, newAlbumId, userId],
    );

    if (result.affectedRows === 0) {
      console.warn("No rows updated. Verify userId exists in the database.");
      return null;
    }

    // Fetch updated user data after updating the profile picture
    const [rows] = await pool.query("SELECT * FROM users WHERE user_id = ?", [
      userId,
    ]);
    return rows[0]; // Return updated user data
  } catch (error) {
    console.error("Error updating user picture:", error);
    throw error; // Throw error for controller to handle
  }
}

// Get country mapping
async function getCountryById(countryId) {
  const [country] = await pool.query(
    "SELECT country_name FROM countries WHERE country_id = ?",
    [countryId],
  );
  return country;
}

async function getAllCountries() {
  const [countries] = await pool.query(
    "SELECT country_id AS id, country_name AS name FROM `system_countries` ORDER BY country_name ASC",
  );
  console.log("Countries fetched from DB:", countries);
  return countries; // Return the flattened array
}

async function createUserSession(
  userId,
  accessToken,
  refreshToken,
  userIp,
  userAgentInfo,
) {
  try {
    const { browser, os, osVersion, deviceName } = userAgentInfo;

    // Delete any previous session for this user
    await pool.query("DELETE FROM users_sessions WHERE user_id = ?", [userId]);

    // Insert new session record with both tokens
    await pool.query(
      `INSERT INTO users_sessions 
      (user_id, session_token, refresh_token, session_date, session_type, user_ip, user_browser, user_os, user_os_version, user_device_name) 
      VALUES (?, ?, ?, NOW(), 'W', ?, ?, ?, ?, ?)`,
      [
        userId,
        accessToken,
        refreshToken,
        userIp,
        browser,
        os,
        osVersion,
        deviceName,
      ],
    );

    console.log(
      "✅ User session created successfully with access and refresh tokens",
    );
  } catch (err) {
    console.error("❌ Error creating user session:", err);
    throw err;
  }
}

module.exports = { createUserSession /* other exports */ };
async function getUserByEmail(email) {
  try {
    console.log("Fetching user by email:", email);

    const [rows] = await pool.query(
      "SELECT * FROM users WHERE user_email = ?",
      [email],
    );

    console.log("Database query result:", rows);

    if (rows.length === 0) {
      console.log("No user found in database for email:", email);
      return null;
    }

    return rows[0]; // Return user object
  } catch (err) {
    console.error("Database query error:", err);
    throw err;
  }
}

async function createUser(userData) {
  const {
    user_name,
    user_email,
    user_password,
    user_firstname,
    user_lastname,
    user_gender,
    user_birthdate,
    user_registered,
  } = userData;

  // Use a 6-digit code for email verification
  const emailVerificationCode = crypto.randomInt(100000, 999999).toString();

  try {
    const query = `
      INSERT INTO users (
        user_name, user_email, user_password, user_firstname, user_lastname, user_gender, user_birthdate, user_registered,
        user_email_verified, user_email_verification_code
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `;
    const [result] = await pool.query(query, [
      user_name,
      user_email,
      user_password,
      user_firstname,
      user_lastname,
      user_gender,
      user_birthdate,
      user_registered || new Date(),
      emailVerificationCode,
    ]);
    return { userId: result.insertId, emailVerificationCode };
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      console.error("Duplicate entry detected:", err);
      console.error("Email:", user_email); // Log the email causing the issue
      throw new Error("This email is already registered");
    }
    throw err;
  }
}
const getRandomUsersWithFriendCounts = async (currentUserId) => {
  try {
    // Step 1: Get first 5 newest users (excluding current user and their friends)
    const firstUsersQuery = `
      SELECT 
        u.user_id,
        u.user_name,
        u.user_picture,
        u.user_current_city,
        u.user_hometown,
        COALESCE(fc.friend_count, 0) AS friend_count
      FROM users u
      LEFT JOIN (
        SELECT 
          user_one_id AS uid, COUNT(*) AS friend_count
        FROM friends WHERE status = 1
        GROUP BY user_one_id
        UNION ALL
        SELECT 
          user_two_id, COUNT(*)
        FROM friends WHERE status = 1
        GROUP BY user_two_id
      ) fc ON fc.uid = u.user_id
      WHERE 
        u.user_id != ? 
        AND u.user_id NOT IN (
          SELECT user_two_id FROM friends WHERE user_one_id = ? AND status = 1
          UNION
          SELECT user_one_id FROM friends WHERE user_two_id = ? AND status = 1
        )
        AND u.user_activated = '1'
      ORDER BY u.user_id ASC
      LIMIT 5;
    `;

    const [firstUsers] = await pool.execute(firstUsersQuery, [
      currentUserId,
      currentUserId,
      currentUserId,
    ]);

    // Step 2: Get current user's location data
    const userQuery = `
      SELECT user_current_city, user_hometown, user_country
      FROM users
      WHERE user_id = ?
    `;
    const [[currentUser]] = await pool.execute(userQuery, [currentUserId]);

    let sameLocationUsers = [];

    if (currentUser) {
      // Step 3: Get users from same location (excluding current user, friends, and users already in firstUsers)
      const firstUserIds = firstUsers.map((u) => u.user_id);

      const locationQuery = `
        SELECT 
          u.user_id,
          u.user_name,
          u.user_picture,
          u.user_current_city,
          u.user_hometown,
          COALESCE(fc.friend_count, 0) AS friend_count
        FROM users u
        LEFT JOIN (
          SELECT 
            user_one_id AS uid, COUNT(*) AS friend_count
          FROM friends WHERE status = 1
          GROUP BY user_one_id
          UNION ALL
          SELECT 
            user_two_id, COUNT(*)
          FROM friends WHERE status = 1
          GROUP BY user_two_id
        ) fc ON fc.uid = u.user_id
        WHERE 
          u.user_id != ? 
          AND u.user_id NOT IN (
            SELECT user_two_id FROM friends WHERE user_one_id = ? AND status = 1
            UNION
            SELECT user_one_id FROM friends WHERE user_two_id = ? AND status = 1
          )
          AND u.user_id NOT IN (${firstUserIds.map(() => "?").join(",")})
          AND u.user_activated = '1'
          AND (
            (u.user_current_city = ? AND u.user_current_city IS NOT NULL)
            OR (u.user_hometown = ? AND u.user_hometown IS NOT NULL)
            OR u.user_country = ?
          )
        ORDER BY u.user_id DESC
        LIMIT 7;
      `;

      const params = [
        currentUserId,
        currentUserId,
        currentUserId,
        ...firstUserIds,
        currentUser.user_current_city || "",
        currentUser.user_hometown || "",
        currentUser.user_country || 0,
      ];

      const [locationUsers] = await pool.execute(locationQuery, params);
      sameLocationUsers = locationUsers;
    }

    // Combine results: first 5 users + same location users
    const combinedUsers = [...firstUsers, ...sameLocationUsers];

    // Remove any duplicates (by user_id) and limit to 12 total
    const uniqueUsers = [];
    const seenIds = new Set();

    for (const user of combinedUsers) {
      if (!seenIds.has(user.user_id)) {
        uniqueUsers.push(user);
        seenIds.add(user.user_id);
      }
    }

    return uniqueUsers.slice(0, 12).map((user) => ({
      ...user,
      user_picture: user.user_picture || null,
    }));
  } catch (error) {
    console.error("Error in getRandomUsersWithFriendCounts:", error);
    throw error;
  }
};
const updateUserResetKey = async (email, resetKey) => {
  console.log(`Updating reset key for email: ${email} with key: ${resetKey}`);
  try {
    const [results] = await pool.query(
      "UPDATE users SET user_reset_key = ?, user_reseted = 1 WHERE user_email = ?",
      [resetKey, email],
    );
    console.log(`Reset key updated successfully for email: ${email}`);
    return results;
  } catch (err) {
    console.error("Error during UPDATE query:", err);
    throw err; // Let the caller handle the error
  }
};

const findUserByResetKey = async (key) => {
  console.log("Searching for user with reset key", { key });
  return pool.query("SELECT * FROM users WHERE user_reset_key = ?", [key]);
};

const updateUserPassword = async (email, hashedPassword) => {
  console.log("Updating password for user", { email });
  return pool.query(
    "UPDATE users SET user_password = ?, user_reset_key = NULL WHERE user_email = ?",
    [hashedPassword, email],
  );
};
const fetchUserDetails = async (userIds) => {
  const query = `
    SELECT * 
    FROM users 
    WHERE user_id IN (?);
  `;

  try {
    const [results] = await pool.query(query, [userIds]);
    return results;
  } catch (err) {
    console.error("Error fetching user details from DB:", err);
    throw err;
  }
};

//Account Settings

// Update username and email
const updateUserNameandEmail = async (userId, username, email) => {
  const query = `UPDATE users SET user_name = ?, user_email = ? WHERE user_id = ?`;
  const [result] = await pool.query(query, [username, email, userId]);
  return result;
};

module.exports = {
  getUserByEmail,
  fetchUserDetails,
  findUserByResetKey,
  updateUserPassword,
  getRandomUsersWithFriendCounts,
  updateUserResetKey,
  createUserSession,
  createUser,
  generateVerificationCode,
  getUserById,
  updateUserProfile,
  updateUserPicture,
  getCountryById,
  getAllCountries,
  updateUserNameandEmail,
  updateUserCoverPicture,
  getUserProfile,
  getUserByIdentifier,
};

async function getUserProfile(userId, currentUserId) {
  console.log("getUserProfile (model): Executing query for userId", {
    userId,
    currentUserId,
  });

  const query = `
    SELECT 
      u.user_id AS id,
      u.user_name AS username,
      u.user_firstname AS name,
      u.user_lastname,
      u.user_picture,
      u.user_cover,
      CASE WHEN u.user_privacy_gender = 'public' OR u.user_id = ? THEN u.user_gender ELSE NULL END AS gender,
      CASE WHEN u.user_privacy_birthdate = 'public' OR u.user_id = ? THEN u.user_birthdate ELSE NULL END AS birthdate,
      CASE WHEN u.user_privacy_location = 'public' OR u.user_id = ? THEN u.user_current_city ELSE NULL END AS current_city,
      CASE WHEN u.user_privacy_location = 'public' OR u.user_id = ? THEN u.user_hometown ELSE NULL END AS hometown,
      CASE WHEN u.user_privacy_work = 'public' OR u.user_id = ? THEN u.user_work_title ELSE NULL END AS work_title,
      CASE WHEN u.user_privacy_work = 'public' OR u.user_id = ? THEN u.user_work_place ELSE NULL END AS work_place,
      CASE WHEN u.user_privacy_work = 'public' OR u.user_id = ? THEN u.user_work_url ELSE NULL END AS work_url,
      CASE WHEN u.user_privacy_education = 'public' OR u.user_id = ? THEN u.user_edu_school ELSE NULL END AS edu_school,
      CASE WHEN u.user_privacy_education = 'public' OR u.user_id = ? THEN u.user_edu_major ELSE NULL END AS edu_major,
      CASE WHEN u.user_privacy_other = 'public' OR u.user_id = ? THEN u.user_biography ELSE NULL END AS biography,
      CASE WHEN u.user_privacy_other = 'public' OR u.user_id = ? THEN u.user_website ELSE NULL END AS website,
      u.user_verified,
      u.user_registered,
      u.user_last_seen,
      CASE 
        WHEN EXISTS(
          SELECT 1 FROM packages_payments 
          WHERE user_id = u.user_id
        ) THEN 1
        ELSE 0
      END AS has_active_membership
    FROM users u
    WHERE u.user_id = ?
  `;

  try {
    console.log("getUserProfile (model): Running query", {
      query,
      params: [
        currentUserId || null,
        currentUserId || null,
        currentUserId || null,
        currentUserId || null,
        currentUserId || null,
        currentUserId || null,
        currentUserId || null,
        currentUserId || null,
        currentUserId || null,
        currentUserId || null,
        currentUserId || null,
        userId,
      ],
    });
    const [rows] = await pool.query(query, [
      currentUserId || null,
      currentUserId || null,
      currentUserId || null,
      currentUserId || null,
      currentUserId || null,
      currentUserId || null,
      currentUserId || null,
      currentUserId || null,
      currentUserId || null,
      currentUserId || null,
      currentUserId || null,
      userId,
    ]);
    console.log("getUserProfile (model): Query result", { rows });
    return rows[0];
  } catch (error) {
    console.error("getUserProfile (model): Query failed", {
      error: error.message,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
    });
    throw error;
  }
}
