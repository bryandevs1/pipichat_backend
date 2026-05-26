const db = require("../config/db"); // your mysql2/promise pool
const { uploadToGoogleCloud } = require("../utils/googleCloud"); // your existing helper

// CREATE FUNDING REQUEST
const createFunding = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const userId = req.user.id;
    const { title, amount, description } = req.body;

    if (!title?.trim() || !amount || !description?.trim()) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Title, amount and description are required",
      });
    }

    const targetAmount = parseFloat(amount);
    if (isNaN(targetAmount) || targetAmount <= 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Invalid amount" });
    }

    let coverImageUrl = null;
    if (req.file) {
      const uploadResult = await uploadToGoogleCloud(req.file, "funding");
      coverImageUrl = uploadResult.url;
    }

    // Create the post
    const [postResult] = await connection.query(
      `INSERT INTO posts 
       (user_id, user_type, post_type, privacy, text, time)
       VALUES (?, 'user', 'funding', 'public', ?, NOW())`,
      [userId, description.trim()]
    );

    const postId = postResult.insertId;

    // Create funding record
    await connection.query(
      `INSERT INTO posts_funding 
       (post_id, title, amount, raised_amount, total_donations, cover_image)
       VALUES (?, ?, ?, 0, 0, ?)`,
      [postId, title.trim(), targetAmount, coverImageUrl]
    );

    await connection.commit();

    res.status(201).json({
      success: true,
      message: "Funding request created successfully!",
      data: { postId, coverImage: coverImageUrl },
    });
  } catch (error) {
    await connection.rollback();
    console.error("createFunding error:", error);
    res.status(500).json({ success: false, message: "Failed to create funding" });
  } finally {
    connection.release();
  }
};

// DONATE TO FUNDING
const donateToFunding = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const donorId = req.user.id;
    const postId = parseInt(req.params.postId);
    const { amount } = req.body;

    const donationAmount = parseFloat(amount);
    if (!donationAmount || donationAmount < 50) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Minimum donation is ₦50" });
    }

    // Lock rows
    const [[donor]] = await connection.query(
      `SELECT user_wallet_balance FROM users WHERE user_id = ? FOR UPDATE`,
      [donorId]
    );

    const [[post]] = await connection.query(
      `SELECT p.user_id FROM posts p WHERE p.post_id = ? AND p.post_type = 'funding' FOR UPDATE`,
      [postId]
    );

    if (!post) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "Funding not found" });
    }

    if (donor.user_wallet_balance < donationAmount) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Insufficient wallet balance" });
    }

    const recipientId = post.user_id;

    // Transfer: donor wallet → recipient funding balance
    await connection.query(
      `UPDATE users 
       SET user_wallet_balance = user_wallet_balance - ?,
           user_funding_balance = user_funding_balance + ?
       WHERE user_id IN (?, ?)`,
      [donationAmount, donationAmount, donorId, recipientId]
    );

    // Update funding stats
    await connection.query(
      `UPDATE posts_funding 
       SET raised_amount = raised_amount + ?,
           total_donations = total_donations + 1
       WHERE post_id = ?`,
      [donationAmount, postId]
    );

    // Log donation
    await connection.query(
      `INSERT INTO posts_funding_donors (user_id, post_id, donation_amount, donation_time)
       VALUES (?, ?, ?, NOW())`,
      [donorId, postId, donationAmount]
    );

    // Log transactions
    await connection.query(
      `INSERT INTO wallet_transactions 
       (user_id, node_type, node_id, amount, type, date, description)
       VALUES 
         (?, 'funding_donation', ?, ?, 'out', NOW(), 'Donated to funding'),
         (?, 'funding_donation', ?, ?, 'in', NOW(), 'Received donation')`,
      [donorId, postId, donationAmount, recipientId, postId, donationAmount]
    );

    await connection.commit();

    res.json({
      success: true,
      message: `₦${donationAmount.toLocaleString()} donated successfully!`,
    });
  } catch (error) {
    await connection.rollback();
    console.error("donateToFunding error:", error);
    res.status(500).json({ success: false, message: "Donation failed" });
  } finally {
    connection.release();
  }
};

// WITHDRAW FUNDING BALANCE TO WALLET
const withdrawFundingToWallet = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const userId = req.user.id;
    const { amount } = req.body;

    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount < 50) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Minimum ₦50" });
    }

    const [[user]] = await connection.query(
      `SELECT 
         COALESCE(user_funding_balance, 0) as funding_balance,
         COALESCE(user_wallet_balance, 0) as wallet_balance
       FROM users WHERE user_id = ? FOR UPDATE`,
      [userId]
    );

    if (user.funding_balance < numAmount) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Insufficient funding balance" });
    }

    await connection.query(
      `UPDATE users 
       SET user_funding_balance = user_funding_balance - ?,
           user_wallet_balance = user_wallet_balance + ?
       WHERE user_id = ?`,
      [numAmount, numAmount, userId]
    );

    await connection.query(
      `INSERT INTO wallet_transactions 
       (user_id, node_type, amount, type, date, description)
       VALUES (?, 'funding_to_wallet', ?, 'in', NOW(), 'Funding withdrawn to wallet')`,
      [userId, numAmount]
    );

    await connection.commit();

    res.json({
      success: true,
      message: `₦${numAmount.toLocaleString()} transferred to wallet!`,
      newWalletBalance: (user.wallet_balance + numAmount).toFixed(2),
    });
  } catch (error) {
    await connection.rollback();
    console.error("withdrawFundingToWallet error:", error);
    res.status(500).json({ success: false, message: "Transfer failed" });
  } finally {
    connection.release();
  }
};

// GET DASHBOARD
const getMyFundingDashboard = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const userId = req.user.id;

    const [[balance]] = await connection.query(
      `SELECT COALESCE(user_funding_balance, 0) as balance FROM users WHERE user_id = ?`,
      [userId]
    );

    const [created] = await connection.query(
      `SELECT 
         p.post_id,
         pf.title,
         pf.amount as target,
         pf.raised_amount,
         pf.cover_image,
         p.time as created_at
       FROM posts p
       JOIN posts_funding pf ON p.post_id = pf.post_id
       WHERE p.user_id = ?
       ORDER BY p.time DESC`,
      [userId]
    );

    const [donations] = await connection.query(
      `SELECT 
         pf.title,
         pf.cover_image,
         pd.donation_amount,
         pd.donation_time
       FROM posts_funding_donors pd
       JOIN posts_funding pf ON pd.post_id = pf.post_id
       WHERE pd.user_id = ?
       ORDER BY pd.donation_time DESC
       LIMIT 50`,
      [userId]
    );

    res.json({
      success: true,
      balance: parseFloat(balance.balance || 0),
      created_fundings: created,
      donations_made: donations,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to load dashboard" });
  } finally {
    connection.release();
  }
};

module.exports = {
  createFunding,
  donateToFunding,
  withdrawFundingToWallet,
  getMyFundingDashboard,
};