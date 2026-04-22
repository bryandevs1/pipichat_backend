const db = require("../config/db");

async function checkExistingFriendship(user_one_id, user_two_id) {
  const query = `
    SELECT * FROM friends
    WHERE (user_one_id = ? AND user_two_id = ?) OR (user_one_id = ? AND user_two_id = ?)
  `;
  const [rows] = await db.query(query, [
    user_one_id,
    user_two_id,
    user_two_id,
    user_one_id,
  ]);
  return rows;
}

async function checkIfBlocked(user_one_id, user_two_id) {
  const query = `
    SELECT * FROM users_blocks
    WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)
  `;
  const [rows] = await db.query(query, [
    user_one_id,
    user_two_id,
    user_two_id,
    user_one_id,
  ]);
  return rows.length > 0;
}

async function createFriendRequest(user_one_id, user_two_id) {
  const query = `
    INSERT INTO friends (user_one_id, user_two_id, status)
    VALUES (?, ?, 0)
  `;
  const [result] = await db.query(query, [user_one_id, user_two_id]); // ✅ destructure
  return result;
}

async function updateFriendRequest(id, status) {
  const query = `
    UPDATE friends
    SET status = ?
    WHERE id = ?
  `;
  return await db.query(query, [status, id]);
}

async function deleteFriendship(id) {
  const query = `
    DELETE FROM friends
    WHERE id = ?
  `;
  return await db.query(query, [id]);
}

async function getFriendRequestById(id) {
  const query = `
    SELECT * FROM friends
    WHERE id = ?
  `;
  const [rows] = await db.query(query, [id]);
  return rows[0];
}

async function getFriends(userId, limit, offset) {
  const query = `
    SELECT 
      u.user_id AS id,
      u.user_name AS username,
      u.user_firstname AS name,
      u.user_lastname,
      u.user_picture
    FROM friends f
    JOIN users u ON (f.user_one_id = u.user_id OR f.user_two_id = u.user_id)
    WHERE (f.user_one_id = ? OR f.user_two_id = ?) AND f.status = 1
    LIMIT ? OFFSET ?
  `;
  const [rows] = await db.query(query, [userId, userId, limit, offset]);
  return rows;
}

async function getSuggestedPeople(userId, limit, offset) {
  const query = `
    SELECT 
      u.user_id AS id,
      u.user_name AS username,
      u.user_firstname AS name,
      u.user_lastname,
      u.user_picture,
      (SELECT COUNT(*) 
       FROM friends f2 
       WHERE f2.status = 1 
         AND ((f2.user_one_id = u.user_id AND f2.user_two_id IN (
           SELECT user_two_id FROM friends WHERE user_one_id = ? AND status = 1
           UNION
           SELECT user_one_id FROM friends WHERE user_two_id = ? AND status = 1
         )) OR (f2.user_two_id = u.user_id AND f2.user_one_id IN (
           SELECT user_two_id FROM friends WHERE user_one_id = ? AND status = 1
           UNION
           SELECT user_one_id FROM friends WHERE user_two_id = ? AND status = 1
         )))) AS mutual_friends
    FROM users u
    WHERE u.user_id != ?
      AND u.user_id NOT IN (
        SELECT user_two_id FROM friends WHERE user_one_id = ? AND status = 1
        UNION
        SELECT user_one_id FROM friends WHERE user_two_id = ? AND status = 1
      )
      AND u.user_id NOT IN (
        SELECT user_two_id FROM friends WHERE user_one_id = ? AND status = 0
        UNION
        SELECT user_one_id FROM friends WHERE user_two_id = ? AND status = 0
      )
    LIMIT ? OFFSET ?
  `;
  try {
    console.log("getSuggestedPeople (model): Running query", {
      query,
      params: [
        userId,
        userId,
        userId,
        userId,
        userId,
        userId,
        userId,
        userId,
        userId,
        limit,
        offset,
      ],
    });
    const [rows] = await db.query(query, [
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
      limit,
      offset,
    ]);
    console.log("getSuggestedPeople (model): Query result", { rows });
    return rows;
  } catch (error) {
    console.error("getSuggestedPeople (model): Query failed", {
      error: error.message,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
    });
    throw error;
  }
}

async function getFriendRequests(userId) {
  console.log("getFriendRequests (model): Executing query for userId", {
    userId,
  });

  const query = `
    SELECT 
      f.id,
      f.user_one_id,
      u.user_name,
      u.user_firstname,
      u.user_lastname,
      u.user_picture,
      (SELECT COUNT(*) 
       FROM friends f2 
       WHERE f2.status = 1 
         AND ((f2.user_one_id = f.user_one_id AND f2.user_two_id IN (
           SELECT user_two_id FROM friends WHERE user_one_id = ? AND status = 1
           UNION
           SELECT user_one_id FROM friends WHERE user_two_id = ? AND status = 1
         )) OR (f2.user_two_id = f.user_one_id AND f2.user_one_id IN (
           SELECT user_two_id FROM friends WHERE user_one_id = ? AND status = 1
           UNION
           SELECT user_one_id FROM friends WHERE user_two_id = ? AND status = 1
         )))) AS mutual_friends
    FROM friends f
    JOIN users u ON f.user_one_id = u.user_id
    WHERE f.user_two_id = ? AND f.status = 0
  `;

  try {
    console.log("getFriendRequests (model): Running query", {
      query,
      params: [userId, userId, userId, userId, userId],
    });
    const [rows] = await db.query(query, [
      userId,
      userId,
      userId,
      userId,
      userId,
    ]);
    console.log("getFriendRequests (model): Query result", { rows });
    return rows;
  } catch (error) {
    console.error("getFriendRequests (model): Query failed", {
      error: error.message,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
    });
    throw error;
  }
}

async function searchUsers(query, userId) {
  console.log(
    "searchUsers (model): Executing query for userId and search query",
    { userId, query },
  );

  const searchPattern = `%${query}%`;
  const queryStr = `
    SELECT 
      u.user_id AS id,
      u.user_name AS username,
      u.user_firstname AS name,
      u.user_lastname,
      u.user_picture,
      (SELECT COUNT(*) 
       FROM friends f2 
       WHERE f2.status = 1 
         AND ((f2.user_one_id = u.user_id AND f2.user_two_id IN (
           SELECT user_two_id FROM friends WHERE user_one_id = ? AND status = 1
           UNION
           SELECT user_one_id FROM friends WHERE user_two_id = ? AND status = 1
         )) OR (f2.user_two_id = u.user_id AND f2.user_one_id IN (
           SELECT user_two_id FROM friends WHERE user_one_id = ? AND status = 1
           UNION
           SELECT user_one_id FROM friends WHERE user_two_id = ? AND status = 1
         )))) AS mutual_friends
    FROM users u
    WHERE (u.user_name LIKE ? OR u.user_firstname LIKE ? OR u.user_lastname LIKE ?)
      AND u.user_id != ?
      AND u.user_id NOT IN (
        SELECT user_two_id FROM friends WHERE user_one_id = ? AND status = 1
        UNION
        SELECT user_one_id FROM friends WHERE user_two_id = ? AND status = 1
      )
      AND u.user_id NOT IN (
        SELECT user_two_id FROM friends WHERE user_one_id = ? AND status = 0
        UNION
        SELECT user_one_id FROM friends WHERE user_two_id = ? AND status = 0
      )
  `;

  try {
    console.log("searchUsers (model): Running query", {
      query: queryStr,
      params: [
        userId,
        userId,
        userId,
        userId,
        searchPattern,
        searchPattern,
        searchPattern,
        userId,
        userId,
        userId,
        userId,
        userId,
      ],
    });
    const [rows] = await db.query(queryStr, [
      userId,
      userId,
      userId,
      userId,
      searchPattern,
      searchPattern,
      searchPattern,
      userId,
      userId,
      userId,
      userId,
      userId,
    ]);
    console.log("searchUsers (model): Query result", { rows });
    return rows;
  } catch (error) {
    console.error("searchUsers (model): Query failed", {
      error: error.message,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
    });
    throw error;
  }
}

async function getUserProfile(userId, currentUserId) {
  const query = `
    SELECT 
      u.user_id AS id,
      u.user_name AS username,
      u.user_firstname AS name,
      u.user_lastname,
      u.user_picture,
      u.user_cover,
      u.user_work_title,
      u.user_work_place,
      u.user_work_url,
      u.user_verified,
      CASE 
        WHEN EXISTS(
          SELECT 1 FROM memberships 
          WHERE user_id = u.user_id AND status = 'active' AND expiry_date > NOW()
        ) THEN 1
        ELSE 0
      END AS has_active_membership,
      (SELECT COUNT(*) 
       FROM followings f1 
       JOIN followings f2 ON f1.following_id = f2.user_id 
       WHERE f1.user_id = ? AND f2.following_id = u.user_id
      ) AS mutual_friends
    FROM users u
    WHERE u.user_id = ?
  `;

  try {
    const [rows] = await db.query(query, [currentUserId, userId]);
    return rows[0] || null;
  } catch (error) {
    console.error("getUserProfile (model) error:", error);
    throw error;
  }
}

async function getConversation(user_one_id, user_two_id) {
  const [conversation] = await db.query(
    `SELECT id
     FROM conversations
     WHERE (user_one_id = ? AND user_two_id = ?) OR (user_one_id = ? AND user_two_id = ?)
     LIMIT 1`,
    [user_one_id, user_two_id, user_two_id, user_one_id],
  );
  return conversation;
}

async function createConversation(user_one_id, user_two_id) {
  const [result] = await db.query(
    `INSERT INTO conversations (user_one_id, user_two_id, created_at)
     VALUES (?, ?, ?)`,
    [user_one_id, user_two_id, new Date()],
  );
  return result;
}

async function getFriendStatus(user_one_id, user_two_id) {
  const [rows] = await db.query(
    `SELECT id, status, user_one_id, user_two_id
     FROM friends
     WHERE (user_one_id = ? AND user_two_id = ?) 
        OR (user_one_id = ? AND user_two_id = ?)
     LIMIT 1`,
    [user_one_id, user_two_id, user_two_id, user_one_id],
  );

  if (rows.length === 0) {
    return { status: "none", requestId: null };
  }

  const friendship = rows[0];

  if (friendship.status === 1) {
    return { status: "friends", requestId: null };
  }

  if (friendship.status === 0) {
    return {
      status:
        friendship.user_one_id === user_one_id
          ? "pending_sent"
          : "pending_received",
      requestId: friendship.id,
    };
  }

  return { status: "none", requestId: null };
}
async function getFollowers(userId, limit, offset) {
  const [rows] = await db.query(
    `SELECT 
       u.user_id AS id,
       u.user_name AS username,
       u.user_picture AS profile_picture
     FROM followings f
     JOIN users u ON f.user_id = u.user_id
     WHERE f.following_id = ?
     LIMIT ? OFFSET ?`,
    [userId, limit, offset],
  );
  return rows;
}

async function getFollowing(userId, limit, offset) {
  const [rows] = await db.query(
    `SELECT 
       u.user_id AS id,
       u.user_name AS username,
       u.user_picture AS profile_picture
     FROM followings f
     JOIN users u ON f.following_id = u.user_id
     WHERE f.user_id = ?
     LIMIT ? OFFSET ?`,
    [userId, limit, offset],
  );
  return rows;
}

async function checkExistingFollow(followerId, followingId) {
  const [follow] = await db.query(
    `SELECT * FROM following WHERE follower_id = ? AND following_id = ?`,
    [followerId, followingId],
  );
  return follow;
}

async function createFollow(followerId, followingId) {
  const [result] = await db.query(
    `INSERT INTO following (follower_id, following_id) VALUES (?, ?)`,
    [followerId, followingId],
  );
  return result;
}
async function getSentRequests(userId) {
  console.log("getSentRequests (model): Executing query for userId", {
    userId,
  });

  const query = `
    SELECT 
      f.id,
      f.user_two_id,
      u.user_name,
      u.user_firstname,
      u.user_lastname,
      u.user_picture,
      (SELECT COUNT(*) 
       FROM friends f2 
       WHERE f2.status = 1 
         AND ((f2.user_one_id = f.user_two_id AND f2.user_two_id IN (
           SELECT user_two_id FROM friends WHERE user_one_id = ? AND status = 1
           UNION
           SELECT user_one_id FROM friends WHERE user_two_id = ? AND status = 1
         )) OR (f2.user_two_id = f.user_two_id AND f2.user_one_id IN (
           SELECT user_two_id FROM friends WHERE user_one_id = ? AND status = 1
           UNION
           SELECT user_one_id FROM friends WHERE user_two_id = ? AND status = 1
         )))) AS mutual_friends
    FROM friends f
    JOIN users u ON f.user_two_id = u.user_id
    WHERE f.user_one_id = ? AND f.status = 0
  `;

  try {
    console.log("getSentRequests (model): Running query", {
      query,
      params: [userId, userId, userId, userId, userId],
    });
    const [rows] = await db.query(query, [
      userId,
      userId,
      userId,
      userId,
      userId,
    ]);
    console.log("getSentRequests (model): Query result", { rows });
    return rows;
  } catch (error) {
    console.error("getSentRequests (model): Query failed", {
      error: error.message,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
    });
    throw error;
  }
}

module.exports = {
  checkExistingFriendship,
  checkIfBlocked,
  createFriendRequest,
  updateFriendRequest,
  deleteFriendship,
  getFriends,
  getSuggestedPeople,
  getFriendRequestById,
  getFriendRequests,
  getSentRequests,
  searchUsers,
  getUserProfile,
  getConversation,
  createConversation,
  getFriendStatus,
  getFollowing,
  getFollowers,
  checkExistingFollow,
  createFollow,
};
