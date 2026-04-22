const db = require("../config/db");

// Get users that a specific user is following (with pagination and search)
const getFollowings = async (userId, viewerId, limit = 20, offset = 0, search = "") => {
  console.log(`Fetching followings for userId: ${userId}, viewerId: ${viewerId}, limit: ${limit}, offset: ${offset}, search: ${search}`);

  // Count total for pagination
  let countQuery = `SELECT COUNT(*) AS total FROM followings f JOIN users u ON f.following_id = u.user_id WHERE f.user_id = ?`;
  let countParams = [userId];
  if (search) {
    countQuery += ` AND u.user_name LIKE ?`;
    countParams.push(`%${search}%`);
  }

  const [countRows] = await db.query(countQuery, countParams);
  const totalCount = parseInt(countRows[0].total);

  // Fetch followings
  let query = `
    SELECT 
      u.user_id AS id, 
      u.user_name AS username, 
      u.user_picture AS profile_picture, 
      f.points_earned, 
      f.time
    FROM followings f
    JOIN users u ON f.following_id = u.user_id
    WHERE f.user_id = ?
  `;
  let params = [userId];
  if (search) {
    query += ` AND u.user_name LIKE ?`;
    params.push(`%${search}%`);
  }
  query += ` ORDER BY f.time DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset));

  try {
    const [rows] = await db.query(query, params);
    console.log(`Followings found: ${rows.length}`);
    return {
      data: rows,
      total_count: totalCount,
      has_more: offset + rows.length < totalCount,
    };
  } catch (error) {
    console.error("Error fetching followings:", error);
    throw error;
  }
};

// Get users who are following a specific user (with pagination and search)
const getFollowers = async (userId, viewerId, limit = 20, offset = 0, search = "") => {
  console.log(`Fetching followers for userId: ${userId}, viewerId: ${viewerId}, limit: ${limit}, offset: ${offset}, search: ${search}`);

  // Count total for pagination
  let countQuery = `SELECT COUNT(*) AS total FROM followings f JOIN users u ON f.user_id = u.user_id WHERE f.following_id = ?`;
  let countParams = [userId];
  if (search) {
    countQuery += ` AND u.user_name LIKE ?`;
    countParams.push(`%${search}%`);
  }

  const [countRows] = await db.query(countQuery, countParams);
  const totalCount = parseInt(countRows[0].total);

  // Fetch followers
  let query = `
    SELECT 
      u.user_id AS id, 
      u.user_name AS username, 
      u.user_picture AS profile_picture, 
      f.points_earned, 
      f.time
    FROM followings f
    JOIN users u ON f.user_id = u.user_id
    WHERE f.following_id = ?
  `;
  let params = [userId];
  if (search) {
    query += ` AND u.user_name LIKE ?`;
    params.push(`%${search}%`);
  }
  query += ` ORDER BY f.time DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset));

  try {
    const [rows] = await db.query(query, params);
    console.log(`Followers found: ${rows.length}`);
    return {
      data: rows,
      total_count: totalCount,
      has_more: offset + rows.length < totalCount,
    };
  } catch (error) {
    console.error("Error fetching followers:", error);
    throw error;
  }
};

// Get total number of followings
const getFollowingsCount = async (userId, viewerId) => {
  console.log(`Counting total followings for userId: ${userId}, viewerId: ${viewerId}`);
  const query = `SELECT COUNT(*) AS total_followings FROM followings WHERE user_id = ?`;
  try {
    const [rows] = await db.query(query, [userId]);
    console.log(`Total followings: ${rows[0].total_followings}`);
    return parseInt(rows[0].total_followings);
  } catch (error) {
    console.error("Error fetching followings count:", error);
    throw error;
  }
};

// Get total number of followers
const getFollowersCount = async (userId, viewerId) => {
  console.log(`Counting total followers for userId: ${userId}, viewerId: ${viewerId}`);
  const query = `SELECT COUNT(*) AS total_followers FROM followings WHERE following_id = ?`;
  try {
    const [rows] = await db.query(query, [userId]);
    console.log(`Total followers: ${rows[0].total_followers}`);
    return parseInt(rows[0].total_followers);
  } catch (error) {
    console.error("Error fetching followers count:", error);
    throw error;
  }
};

// Check if viewer follows the user
const isFollowing = async (viewerId, targetId) => {
  const query = `SELECT 1 FROM followings WHERE user_id = ? AND following_id = ?`;
  try {
    const [rows] = await db.query(query, [viewerId, targetId]);
    return rows.length > 0;
  } catch (error) {
    console.error("Error checking if following:", error);
    throw error;
  }
};

// Follow a user
const followUser = async (viewerId, targetId) => {
  if (await isFollowing(viewerId, targetId)) {
    throw new Error("Already following this user");
  }
  const query = `INSERT INTO followings (user_id, following_id, points_earned, time) VALUES (?, ?, '0', NOW())`;
  try {
    await db.query(query, [viewerId, targetId]);
    console.log(`User ${viewerId} now follows ${targetId}`);
  } catch (error) {
    console.error("Error following user:", error);
    throw error;
  }
};

// Unfollow a user
const unfollowUser = async (viewerId, targetId) => {
  const query = `DELETE FROM followings WHERE user_id = ? AND following_id = ?`;
  try {
    const [result] = await db.query(query, [viewerId, targetId]);
    if (result.affectedRows === 0) {
      throw new Error("Not following this user");
    }
    console.log(`User ${viewerId} unfollowed ${targetId}`);
  } catch (error) {
    console.error("Error unfollowing user:", error);
    throw error;
  }
};

module.exports = {
  getFollowings,
  getFollowers,
  getFollowingsCount,
  getFollowersCount,
  isFollowing,
  followUser,
  unfollowUser,
};