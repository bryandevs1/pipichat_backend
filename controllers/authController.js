const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const pool = require("../config/db");
const UAParser = require("ua-parser-js");
const nodemailer = require("nodemailer");
const { giveReferralBonus } = require("./affiliateController"); // Add this import
const speakeasy = require("speakeasy");

const {
  getUserByEmail,
  createUserSession,
  createUser,
  generateVerificationCode,
  updateUserResetKey,
  findUserByResetKey,
  updateUserPassword,
  getUserByIdentifier,
} = require("../models/userModel");

const {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendNewSessionEmail,
} = require("../utils/email");

const isValidDate = (dateString) => {
  const regex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  if (!regex.test(dateString)) {
    console.error("Regex failed for:", dateString);
    return false;
  }
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    console.error("Invalid Date object for:", dateString);
    return false;
  }
  const [year, month, day] = dateString.split("-");
  const isMatch =
    date.getUTCFullYear() === parseInt(year, 10) &&
    date.getUTCMonth() === parseInt(month, 10) - 1 &&
    date.getUTCDate() === parseInt(day, 10);
  if (!isMatch) {
    console.error("Date mismatch for:", dateString, date);
  }
  return isMatch;
};

async function login(req, res) {
  const { email, password } = req.body;

  try {
    const user = await getUserByIdentifier(email);

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (!user.user_password) {
      return res
        .status(404)
        .json({ success: false, message: "Password not found for user" });
    }

    // ✅ Check if banned
    if (user.user_banned === "1") {
      return res.status(403).json({
        success: false,
        message: user.user_banned_message || "Your account has been banned.",
        reason: "banned",
      });
    }

    // ✅ Check if email is verified
    if (user.user_email_verified === "0") {
      return res.status(403).json({
        success: false,
        message: "Please verify your email before logging in.",
        reason: "email_not_verified",
      });
    }

    // ✅ Check if account is activated
    if (user.user_activated === "0") {
      return res.status(403).json({
        success: false,
        message: "Your account is not activated yet.",
        reason: "not_activated",
      });
    }

    const normalizedHash = user.user_password.replace("$2y$", "$2b$");
    const isMatch = await bcrypt.compare(password, normalizedHash);

    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    // ✅ If 2FA is enabled, return a pre-auth flag (no token yet)
    if (user.user_two_factor_enabled === "1") {
      // Issue a short-lived temp token to identify the user during 2FA step
      const tempToken = jwt.sign(
        { id: user.user_id, pending2FA: true },
        process.env.JWT_SECRET,
        { expiresIn: "5m" },
      );

      return res.json({
        success: true,
        requires2FA: true,
        tempToken,
        message: "2FA verification required",
      });
    }

    // ✅ No 2FA — issue full tokens
    const accessToken = jwt.sign(
      { id: user.user_id, email: user.user_email },
      process.env.JWT_SECRET,
      { expiresIn: "3d" },
    );

    const refreshToken = jwt.sign(
      { id: user.user_id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" },
    );

    const userIp =
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      req.socket.remoteAddress ||
      "Unknown";

    const parser = new UAParser(req.headers["user-agent"]);
    const userAgentInfo = {
      browser: parser.getBrowser().name || "Unknown",
      os: parser.getOS().name || "Unknown",
      osVersion: parser.getOS().version || "Unknown",
      deviceName: parser.getDevice().model || "Unknown",
    };

    await createUserSession(
      user.user_id,
      accessToken,
      refreshToken,
      userIp,
      userAgentInfo,
    );
    await sendNewSessionEmail(user.user_email, userAgentInfo, userIp);

    const { user_password, ...safeUserDetails } = user;

    res.json({
      success: true,
      requires2FA: false,
      message: "Login successful",
      accessToken,
      refreshToken,
      user: safeUserDetails,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

async function verify2FALogin(req, res) {
  const { tempToken, code } = req.body;

  if (!tempToken || !code) {
    return res
      .status(400)
      .json({ success: false, message: "Token and code are required" });
  }

  try {
    // Verify the temp token
    let decoded;
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
    } catch (e) {
      return res.status(401).json({
        success: false,
        message: "Session expired. Please log in again.",
      });
    }

    if (!decoded.pending2FA) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid temp token" });
    }

    const userId = decoded.id;

    // Get user's 2FA secret
    const [users] = await pool.query("SELECT * FROM users WHERE user_id = ?", [
      userId,
    ]);

    if (!users.length) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const user = users[0];

    const isValid = speakeasy.totp.verify({
      secret: user.user_two_factor_gsecret,
      encoding: "base32",
      token: code.trim(),
      window: 2,
    });

    if (!isValid) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid 2FA code" });
    }

    // 2FA passed — now issue real tokens
    const accessToken = jwt.sign(
      { id: user.user_id, email: user.user_email },
      process.env.JWT_SECRET,
      { expiresIn: "3d" },
    );

    const refreshToken = jwt.sign(
      { id: user.user_id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" },
    );

    const userIp =
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      req.socket.remoteAddress ||
      "Unknown";

    const parser = new UAParser(req.headers["user-agent"]);
    const userAgentInfo = {
      browser: parser.getBrowser().name || "Unknown",
      os: parser.getOS().name || "Unknown",
      osVersion: parser.getOS().version || "Unknown",
      deviceName: parser.getDevice().model || "Unknown",
    };

    await createUserSession(
      user.user_id,
      accessToken,
      refreshToken,
      userIp,
      userAgentInfo,
    );
    await sendNewSessionEmail(user.user_email, userAgentInfo, userIp);

    const {
      user_password,
      user_reset_key,
      user_email_verification_code,
      ...safeUserDetails
    } = user;

    res.json({
      success: true,
      message: "Login successful",
      accessToken,
      refreshToken,
      user: safeUserDetails,
    });
  } catch (err) {
    console.error("2FA login verify error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

async function completeOnboarding(req, res) {
  try {
    await pool.query("UPDATE users SET user_started = '1' WHERE user_id = ?", [
      req.user.id,
    ]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
}

async function verifyEmail(req, res) {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({
      success: false,
      message: "Email and verification code are required",
    });
  }
  try {
    const user = await getUserByEmail(email);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    if (user.user_email_verification_code === code) {
      const [updateResult] = await pool.query(
        "UPDATE users SET user_email_verified = '1', user_activated = '1' WHERE user_email = ?",
        [email],
      );
      const [updatedUser] = await pool.query(
        "SELECT * FROM users WHERE user_email = ?",
        [email],
      );
      if (updatedUser[0]?.user_email_verified === "1") {
        const verifiedUser = updatedUser[0];

        // ✅ NOW generate and return tokens after verification
        // Use same expiration as login (3d for access, 7d for refresh)
        const accessToken = jwt.sign(
          { id: verifiedUser.user_id, email: verifiedUser.user_email },
          process.env.JWT_SECRET,
          { expiresIn: "3d" }, // Match login expiration
        );

        const refreshToken = jwt.sign(
          { id: verifiedUser.user_id },
          process.env.JWT_REFRESH_SECRET,
          { expiresIn: "7d" },
        );

        // Extract user IP and agent info from request
        const userIp =
          req.headers["x-forwarded-for"]?.split(",")[0] ||
          req.socket.remoteAddress ||
          "Unknown";

        const parser = new UAParser(req.headers["user-agent"]);
        const userAgentInfo = {
          browser: parser.getBrowser().name || "Unknown",
          os: parser.getOS().name || "Unknown",
          osVersion: parser.getOS().version || "Unknown",
          deviceName: parser.getDevice().model || "Unknown",
        };

        await createUserSession(
          verifiedUser.user_id,
          accessToken,
          refreshToken,
          userIp,
          userAgentInfo,
        );

        return res.status(200).json({
          success: true,
          message: "Email successfully verified",
          accessToken,
          refreshToken,
          user: {
            user_id: verifiedUser.user_id,
            user_name: verifiedUser.user_name,
            user_email: verifiedUser.user_email,
            user_firstname: verifiedUser.user_firstname,
            user_lastname: verifiedUser.user_lastname,
            user_picture: verifiedUser.user_picture,
            user_started: verifiedUser.user_started,
            user_activated: verifiedUser.user_activated,
            user_email_verified: verifiedUser.user_email_verified,
          },
        });
      }
      return res.status(500).json({
        success: false,
        message: "Failed to update verification status",
      });
    }
    return res
      .status(400)
      .json({ success: false, message: "Invalid verification code" });
  } catch (err) {
    console.error("Error in email verification:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

// Resend verification code
async function resendVerificationCode(req, res) {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required",
    });
  }
  try {
    const user = await getUserByEmail(email);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Check if user is already verified
    if (user.user_email_verified === "1") {
      return res.status(400).json({
        success: false,
        message: "Email is already verified",
      });
    }

    // Generate new verification code
    const newVerificationCode = String(
      Math.floor(100000 + Math.random() * 900000),
    );

    // Update the verification code in database
    await pool.query(
      "UPDATE users SET user_email_verification_code = ? WHERE user_email = ?",
      [newVerificationCode, email],
    );

    // Send verification email with new code
    const emailSent = await sendVerificationEmail(
      email,
      newVerificationCode,
      null,
    );

    if (!emailSent) {
      return res.status(500).json({
        success: false,
        message: "Failed to send verification email",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Verification code has been resent to your email",
    });
  } catch (err) {
    console.error("Error resending verification code:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

// authController.js → signup function (UPDATED WITH REFERRALS & BONUS)

// Helper to generate a referral code from username + userId
function generateReferralCode(username, userId) {
  const userPrefix = username.substring(0, 3).toLowerCase();
  const userIdPadded = String(userId).padStart(3, "0");
  return `${userPrefix}${userIdPadded}`;
}

// Helper to decode a referral code back to its parts for lookup
function decodeReferralCode(refCode) {
  // Last 3+ chars are the padded ID, first 3 are username prefix
  const idPart = refCode.slice(3); // e.g. "009" → 9
  const userPrefix = refCode.slice(0, 3); // e.g. "joh"
  return {
    userId: parseInt(idPart, 10),
    userPrefix,
  };
}

async function signup(req, res) {
  const {
    username,
    firstName,
    lastName,
    email,
    password,
    gender,
    birthdate,
    referralCode,
  } = req.body; // <-- referralCode is now a body field

  const user_name = username;
  const user_email = email;
  const user_password = password;
  const user_firstname = firstName;
  const user_lastname = lastName || "";
  const user_gender = gender || 0;
  const user_birthdate = birthdate;

  const requiredFields = {
    user_name,
    user_email,
    user_password,
    user_firstname,
    user_birthdate,
  };
  const missingFields = Object.keys(requiredFields).filter(
    (key) => !requiredFields[key],
  );
  if (missingFields.length > 0) {
    return res.status(400).json({
      success: false,
      message: `Missing fields: ${missingFields.join(", ")}`,
    });
  }

  const formattedDate =
    user_birthdate instanceof Date
      ? user_birthdate.toISOString().split("T")[0]
      : String(user_birthdate);
  if (!isValidDate(formattedDate)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid birthdate format" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Check if email exists
    const [existingUser] = await connection.query(
      "SELECT user_id FROM users WHERE user_email = ? LIMIT 1",
      [user_email],
    );
    if (existingUser.length > 0) {
      await connection.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Email is already registered" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(user_password, 10);

    // Create user
    const [result] = await connection.query(
      `INSERT INTO users (
        user_name, user_email, user_password, user_firstname, user_lastname,
        user_gender, user_birthdate, user_registered, user_activated, user_email_verified
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), '0', '0')`,
      [
        user_name,
        user_email,
        hashedPassword,
        user_firstname,
        user_lastname,
        user_gender,
        formattedDate,
      ],
    );

    const newUserId = result.insertId;

    // Generate this new user's own referral code and store it
    const newUserReferralCode = generateReferralCode(user_name, newUserId);
    await connection.query(
      `UPDATE users SET user_referral_code = ? WHERE user_id = ?`,
      [newUserReferralCode, newUserId],
    );

    let referrerId = null;

    // Handle Referral (if a referral code was typed in during signup)
    if (referralCode && referralCode.trim().length >= 4) {
      const cleanCode = referralCode.trim().toLowerCase();
      const { userId: guessedId, userPrefix } = decodeReferralCode(cleanCode);

      // Look up referrer by decoded user ID, then verify the username prefix matches
      // This double-check prevents a guessed numeric ID from bypassing the code
      const [referrers] = await connection.query(
        `SELECT user_id, user_name, user_referral_code 
         FROM users 
         WHERE user_id = ? 
         AND LOWER(SUBSTRING(user_name, 1, 3)) = ?
         LIMIT 1`,
        [guessedId, userPrefix],
      );

      if (
        referrers.length > 0 &&
        referrers[0].user_referral_code === cleanCode
      ) {
        referrerId = referrers[0].user_id;

        // Set referrer on new user
        await connection.query(
          `UPDATE users SET user_referrer_id = ? WHERE user_id = ?`,
          [referrerId, newUserId],
        );

        // Record referral relationship
        await connection.query(
          `INSERT INTO users_affiliates (referrer_id, referee_id) VALUES (?, ?)`,
          [referrerId, newUserId],
        );

        console.log(
          `User ${newUserId} registered via referral code "${cleanCode}" from user ${referrerId}`,
        );
      } else {
        // Code didn't match anyone — silently ignore, signup continues
        console.log(`Referral code "${cleanCode}" not matched, ignoring.`);
      }
    }

    // Generate email verification code
    const emailVerificationCode = String(
      Math.floor(100000 + Math.random() * 900000),
    );
    await connection.query(
      `UPDATE users SET user_email_verification_code = ? WHERE user_id = ?`,
      [emailVerificationCode, newUserId],
    );

    await connection.commit();

    // Give affiliate bonus (points + wallet) — outside transaction for performance
    if (referrerId) {
      giveReferralBonus(referrerId, newUserId).catch(console.error);
    }

    // ✅ DO NOT return tokens on signup - email must be verified first
    // Send verification email (code only, no URL)
    sendVerificationEmail(
      user_email,
      emailVerificationCode,
      null, // Don't send verification URL, just the code
    ).catch(console.error);

    // Get fresh user data
    const [newUserRows] = await pool.query(
      "SELECT * FROM users WHERE user_id = ?",
      [newUserId],
    );
    const newUser = newUserRows[0];

    res.status(201).json({
      success: true,
      message:
        "User registered successfully. Please check your email to verify your account.",
      user: {
        user_id: newUser.user_id,
        user_name: newUser.user_name,
        user_email: newUser.user_email,
        user_firstname: newUser.user_firstname,
        user_lastname: newUser.user_lastname,
        user_picture: newUser.user_picture,
        user_referral_code: newUser.user_referral_code,
      },
      // ✅ NO TOKENS RETURNED - user must verify email first
      referred_by: referrerId || null,
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("Error in signup:", err);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    if (connection) connection.release();
  }
}

async function requestPasswordReset(req, res) {
  const { user_email } = req.body;
  try {
    const user = await getUserByEmail(user_email);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    const resetKey = Math.floor(100000 + Math.random() * 900000).toString();
    await updateUserResetKey(user_email, resetKey);
    const resetLink = `${process.env.APP_BASE_URL}/reset-password?key=${resetKey}`;
    const emailSent = await sendPasswordResetEmail(
      user_email,
      resetLink,
      resetKey,
    );
    if (emailSent) {
      return res.json({
        success: true,
        message: "Reset email sent successfully",
      });
    }
    return res
      .status(500)
      .json({ success: false, message: "Error sending reset email" });
  } catch (error) {
    console.error("Password reset error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

async function validateResetKey(req, res) {
  const { resetKey } = req.body;
  try {
    const [results] = await pool.query(
      "SELECT * FROM users WHERE user_reset_key = ?",
      [resetKey],
    );
    if (results.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid reset key" });
    }
    res.json({ success: true, message: "Valid reset key" });
  } catch (error) {
    console.error("Error validating reset key:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

async function resetPassword(req, res) {
  const { key, newPassword } = req.body;
  try {
    const [users] = await pool.query(
      "SELECT user_email FROM users WHERE user_reset_key = ?",
      [key],
    );
    if (users.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid reset key" });
    }
    const user = users[0];
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const [updateResult] = await pool.query(
      "UPDATE users SET user_password = ?, user_reset_key = NULL WHERE user_email = ?",
      [hashedPassword, user.user_email],
    );
    if (updateResult.affectedRows === 0) {
      throw new Error("Database update failed");
    }
    res.json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

async function me(req, res) {
  try {
    const [users] = await pool.query("SELECT * FROM users WHERE user_id = ?", [
      req.user.id,
    ]);
    if (users.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    const {
      user_password,
      user_reset_key,
      user_email_verification_code,
      ...safeUserDetails
    } = users[0];
    res.json({ success: true, data: safeUserDetails });
  } catch (error) {
    console.error("Me endpoint error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

async function refreshToken(req, res) {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res
      .status(400)
      .json({ success: false, message: "Refresh token required" });
  }
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const [users] = await pool.query("SELECT * FROM users WHERE user_id = ?", [
      decoded.id,
    ]);
    if (users.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    const newAccessToken = jwt.sign(
      { id: users[0].user_id },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
    );
    res.json({ success: true, accessToken: newAccessToken });
  } catch (error) {
    console.error("Refresh token error:", error);
    res.status(401).json({ success: false, message: "Invalid refresh token" });
  }
}

module.exports = {
  login,
  signup,
  verifyEmail,
  resendVerificationCode,
  requestPasswordReset,
  validateResetKey,
  resetPassword,
  me,
  refreshToken,
  completeOnboarding,
  verify2FALogin,
};
