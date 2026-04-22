const {
  getUserById,
  updateUserProfile,
  updateUserPicture,
  getCountryById,
  fetchUserNames,
  fetchUserDetails,
  updateUserCoverPicture,
  getUserProfile,
} = require("../models/userModel");
const { uploadToGoogleCloud } = require("../utils/googleCloud"); // Utility for uploading media
const { getAllCountries } = require("../models/userModel"); // Update the path as needed
const { v4: uuidv4 } = require("uuid");
const userModel = require("../models/userModel");
const db = require("../config/db");
const {
  sendVerificationEmail,
  sendDataRequestEmails,
} = require("../utils/email");
const bcrypt = require("bcryptjs");
const Joi = require("joi");
const jwt = require("jsonwebtoken");

const speakeasy = require("speakeasy");
const QRCode = require("qrcode"); // Ensure correct import

// Get all countries
const getCountries = async (req, res) => {
  try {
    const countries = await getAllCountries();

    if (!countries || countries.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No countries found." });
    }

    res.status(200).json({ success: true, data: countries });
  } catch (error) {
    console.error("Error fetching countries:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch countries." });
  }
};

// Update user profile
async function updateUserProfileController(req, res) {
  const userId = req.user.id; // Extracted from token
  const {
    user_name,
    user_biography,
    user_work_title,
    user_work_place,
    user_work_url,
    user_current_city,
    user_hometown,
    user_edu_school,
    user_edu_class,
    user_country,
  } = req.body;

  console.log("updateUserProfileController: Incoming Request Body:", req.body);
  console.log("updateUserProfileController: User ID:", userId);

  // Validation schema
  const schema = Joi.object({
    user_name: Joi.string().min(3).max(50).optional(),
    user_biography: Joi.string().max(200).allow("").optional(),
    user_work_title: Joi.string().max(100).allow("").optional(),
    user_work_place: Joi.string().max(100).allow("").optional(),
    user_work_url: Joi.string().uri().allow("").optional(),
    user_current_city: Joi.string().max(100).allow("").optional(),
    user_hometown: Joi.string().max(100).allow("").optional(),
    user_edu_school: Joi.string().max(100).allow("").optional(),
    user_edu_class: Joi.string().max(100).allow("").optional(),
    user_country: Joi.number().integer().positive().optional(),
  });

  const { error } = schema.validate(req.body);
  if (error) {
    console.error(
      "updateUserProfileController: Validation error:",
      error.details[0].message,
    );
    return res
      .status(400)
      .json({ success: false, message: error.details[0].message });
  }

  try {
    const profileData = {
      user_name,
      user_biography,
      user_work_title,
      user_work_place,
      user_work_url,
      user_current_city,
      user_hometown,
      user_edu_school,
      user_edu_class,
      user_country,
    };

    // Remove undefined fields
    Object.keys(profileData).forEach(
      (key) => profileData[key] === undefined && delete profileData[key],
    );

    if (!Object.keys(profileData).length) {
      return res
        .status(400)
        .json({ success: false, message: "No fields provided for update" });
    }

    console.log(
      "updateUserProfileController: Profile Data to Update:",
      profileData,
    );

    await updateUserProfile(userId, profileData);
    res
      .status(200)
      .json({ success: true, message: "Profile updated successfully" });
    console.log(
      "updateUserProfileController: Profile updated successfully for User ID:",
      userId,
    );
  } catch (err) {
    console.error("updateUserProfileController: Error updating profile:", err);
    res
      .status(500)
      .json({ success: false, message: err.message || "Server error" });
  }
}
// Upload profile picture
async function uploadProfilePictureController(req, res) {
  const userId = req.user?.id; // Extracted from token safely
  const { file } = req;

  console.log(
    "🔹 Received request to upload profile picture for userId:",
    userId,
  );

  if (!userId) {
    console.error("❌ Unauthorized request - No user ID");
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  if (!file) {
    console.error("❌ No file uploaded");
    return res
      .status(400)
      .json({ success: false, message: "No file uploaded" });
  }

  try {
    console.log("🔹 Uploading file to Google Cloud...");

    const uploadResponse = await uploadToGoogleCloud(file, "uploads/photos");

    if (!uploadResponse || !uploadResponse.url) {
      console.error(
        "❌ Failed to upload file to Google Cloud. Response:",
        uploadResponse,
      );

      return res.status(500).json({
        success: false,
        message: "Failed to upload file",
      });
    }

    const pictureUrl = uploadResponse.url;

    console.log("✅ File uploaded successfully:", pictureUrl);

    // Update user profile picture in the database
    console.log("🔹 Updating database for userId:", userId);

    const updatedUserData = await updateUserPicture(userId, pictureUrl);

    if (!updatedUserData) {
      console.error(
        "❌ Failed to update user picture in database. User may not exist.",
      );

      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    console.log(
      "✅ Profile picture updated successfully in database:",
      updatedUserData,
    );

    return res.status(200).json({
      success: true,
      message: "Profile picture uploaded successfully",
      data: {
        ...updatedUserData,
        picture: pictureUrl,
      },
    });
  } catch (err) {
    console.error("❌ Server error while uploading profile picture:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

async function uploadCoverPictureController(req, res) {
  console.log("🔹 Extracted userId from token:", req.userId);
  if (!req.user?.id) {
    console.error("❌ Missing userId in request. Authentication issue?");
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }
  const userId = req.userId || req.user?.id; // ✅ Use 'id' if 'userId' is undefined
  const { file } = req;

  console.log(
    "🔹 Received request to upload profile picture for userId:",
    userId,
  );

  if (!file) {
    console.error("❌ No file uploaded");
    return res
      .status(400)
      .json({ success: false, message: "No file uploaded" });
  }

  try {
    console.log("🔹 Uploading file to Google Cloud...");
    const uploadResponse = await uploadToGoogleCloud(file, "uploads/photos");

    if (!uploadResponse || !uploadResponse.url) {
      console.error(
        "❌ Failed to upload file to Google Cloud. Response:",
        uploadResponse,
      );
      return res
        .status(500)
        .json({ success: false, message: "Failed to upload file" });
    }

    console.log("✅ File uploaded successfully:", uploadResponse.url);

    // Update user profile picture in the database
    console.log("🔹 Updating database for userId:", userId);
    const updatedUserData = await updateUserCoverPicture(
      userId,
      uploadResponse.url,
    );

    if (!updatedUserData) {
      console.error(
        "❌ Failed to update user picture in database. User may not exist.",
      );
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    console.log(
      "✅ Profile picture updated successfully in database:",
      updatedUserData,
    );

    res.status(200).json({
      success: true,
      message: "Profile picture uploaded successfully",
      data: updatedUserData, // Send updated user data
    });
  } catch (err) {
    console.error("❌ Server error while uploading profile picture:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}
// Get country by ID
async function getCountryController(req, res) {
  const { countryId } = req.params;

  try {
    const country = await getCountryById(countryId);
    if (!country) {
      return res
        .status(404)
        .json({ success: false, message: "Country not found" });
    }

    res.status(200).json({ success: true, data: country });
  } catch (err) {
    console.error("Error fetching country:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

async function verifyPasswordController(req, res) {
  const userId = req.user.id; // Extracted from token
  const { currentPassword } = req.body;

  if (!currentPassword) {
    return res
      .status(400)
      .json({ success: false, message: "Current password is required" });
  }

  try {
    const [user] = await db.query(
      "SELECT user_password FROM users WHERE user_id = ?",
      [userId],
    );

    if (!user || user.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const storedHashedPassword = user[0].user_password;
    const isMatch = await bcrypt.compare(currentPassword, storedHashedPassword);

    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Incorrect password" });
    }

    return res
      .status(200)
      .json({ success: true, message: "Password verified successfully" });
  } catch (error) {
    console.error("Error verifying password:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

const showRandomUsers = async (req, res) => {
  try {
    // Get current user ID from token
    const currentUserId = req.user.id;

    // Get users: first 5 newest users + users from same location
    const randomUsers =
      await userModel.getRandomUsersWithFriendCounts(currentUserId);

    res.status(200).json({
      success: true,
      data: randomUsers,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch random users.",
    });
  }
};

// Controller function to get user by ID and return the userName
const getUserNames = async (req, res) => {
  try {
    const { userIds } = req.body;
    console.log("User IDs:", userIds);

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: "Invalid userIds array" });
    }

    // Fetch all columns for the specified user IDs
    const users = await userModel.fetchUserDetails(userIds);

    res.status(200).json(users);
  } catch (err) {
    console.error("Error in getUserNames controller:", err);
    res.status(500).json({ error: "Server error" });
  }
};

//Account Settings

const updateUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const { username, email } = req.body;

    if (!username && !email) {
      return res
        .status(400)
        .json({ success: false, message: "Username or email is required" });
    }

    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid email format" });
      }
    }

    if (username) {
      const [existingUser] = await db.query(
        "SELECT user_id FROM users WHERE user_name = ? AND user_id != ?",
        [username, userId],
      );
      if (existingUser.length > 0) {
        return res
          .status(400)
          .json({ success: false, message: "Username is already taken" });
      }
    }

    const [currentUser] = await db.query(
      "SELECT user_email, user_name FROM users WHERE user_id = ?",
      [userId],
    );

    if (!currentUser || currentUser.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const currentEmail = currentUser[0].user_email;
    const currentUsername = currentUser[0].user_name;

    const updates = [];
    const values = [];
    let pendingEmail = null;
    let verificationCode = null; // ← DEFINED HERE

    if (username && username !== currentUsername) {
      updates.push("user_name = ?");
      values.push(username);
    }

    if (email && email.toLowerCase() !== currentEmail?.toLowerCase()) {
      const [existingEmail] = await db.query(
        "SELECT user_id FROM users WHERE user_email = ? AND user_id != ?",
        [email.toLowerCase(), userId],
      );
      if (existingEmail.length > 0) {
        return res
          .status(400)
          .json({ success: false, message: "Email already in use" });
      }

      // Generate code BEFORE using it
      verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

      updates.push("user_email_verification_code = ?");
      updates.push("pending_email = ?");
      updates.push("user_email_verified = '0'");
      values.push(verificationCode, email.toLowerCase());

      pendingEmail = email.toLowerCase();
    }

    if (updates.length === 0) {
      return res
        .status(200)
        .json({ success: true, message: "No changes made" });
    }

    values.push(userId);
    const query = `UPDATE users SET ${updates.join(", ")} WHERE user_id = ?`;
    const [updateResult] = await db.query(query, values);

    if (updateResult.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Now safe to use verificationCode
    if (pendingEmail) {
      const emailSent = await sendVerificationEmail(
        pendingEmail,
        verificationCode,
      );
      if (!emailSent) {
        return res.status(500).json({
          success: false,
          message: "Failed to send verification email",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Verification email sent. Please check your inbox.",
        pendingEmail,
      });
    }

    res
      .status(200)
      .json({ success: true, message: "Account updated successfully" });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const updateUserEmail = async (req, res) => {
  const { userId, newEmail } = req.body;

  if (!userId || !newEmail) {
    return res
      .status(400)
      .json({ success: false, message: "User ID and new email are required" });
  }

  try {
    // Normalize email to lowercase for case-insensitive comparison
    const normalizedEmail = newEmail.trim().toLowerCase();

    // Check if the new email already exists in the system
    const [existingUser] = await db.query(
      "SELECT user_id FROM users WHERE user_email = ? AND user_id != ?",
      [normalizedEmail, userId],
    );
    if (existingUser.length > 0) {
      return res
        .status(400)
        .json({ success: false, message: "Email already in use" });
    }

    // Generate a 6-digit verification code as a string
    const verificationCode = Math.floor(
      100000 + Math.random() * 900000,
    ).toString();

    // Store the verification code and pending email
    const [updateResult] = await db.query(
      "UPDATE users SET user_email_verification_code = ?, pending_email = ?, user_email_verified = 0 WHERE user_id = ?",
      [verificationCode, normalizedEmail, userId],
    );

    if (updateResult.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Send verification code via email without verificationUrl
    const emailSent = await sendVerificationEmail(
      normalizedEmail,
      verificationCode,
    );

    if (!emailSent) {
      console.error("Email sending failed:", normalizedEmail);
      return res.status(500).json({
        success: false,
        message: "Failed to send verification email. Please try again later.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Verification code sent successfully to new email.",
      pendingEmail: normalizedEmail,
    });
  } catch (error) {
    console.error("Error updating email:", error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
};

const verifyEmailChange = async (req, res) => {
  const { userId, code, newEmail } = req.body;

  if (!userId || !code || !newEmail) {
    return res.status(400).json({
      success: false,
      message: "User ID, verification code, and new email are required",
    });
  }

  try {
    // Fetch stored verification code and pending email
    const [user] = await db.query(
      "SELECT user_email_verification_code, pending_email FROM users WHERE user_id = ?",
      [userId],
    );

    if (!user || user.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const storedCode = user[0].user_email_verification_code;
    const storedPendingEmail = user[0].pending_email;

    if (
      storedCode !== code ||
      storedPendingEmail !== newEmail.trim().toLowerCase()
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code or email",
      });
    }

    // Update the email and mark as verified
    await db.query(
      "UPDATE users SET user_email = ?, user_email_verified = '1', user_email_verification_code = NULL, pending_email = NULL WHERE user_id = ?",
      [newEmail.trim().toLowerCase(), userId],
    );

    res.status(200).json({
      success: true,
      message: "Email updated and verified successfully",
    });
  } catch (error) {
    console.error("Error verifying email:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const checkUsernameAvailability = async (req, res) => {
  try {
    const { username } = req.params;

    // Check if the username already exists
    const [existingUser] = await db.query(
      "SELECT user_id FROM users WHERE user_name = ?",
      [username],
    );

    if (existingUser.length > 0) {
      return res
        .status(200)
        .json({ available: false, message: "Username is already taken." });
    }

    return res
      .status(200)
      .json({ available: true, message: "Username is available." });
  } catch (error) {
    console.error("Error checking username availability:", error);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
};

const updateUserWork = async (req, res) => {
  const { userId, workTitle, workPlace, workUrl } = req.body;

  try {
    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "User ID is required" });
    }

    // Create an array to store fields to update
    const updates = [];
    const values = [];

    if (workTitle !== undefined) {
      updates.push("user_work_title = ?");
      values.push(workTitle);
    }
    if (workPlace !== undefined) {
      updates.push("user_work_place = ?");
      values.push(workPlace);
    }
    if (workUrl !== undefined) {
      if (!/^https?:\/\//.test(workUrl)) {
        return res.status(400).json({
          success: false,
          message: "Work URL must start with http:// or https://",
        });
      }
      updates.push("user_work_url = ?");
      values.push(workUrl);
    }

    // If no fields are provided, return an error
    if (updates.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No fields to update" });
    }

    values.push(userId);

    // Build the SQL query dynamically
    const query = `UPDATE users SET ${updates.join(", ")} WHERE user_id = ?`;

    const [result] = await db.query(query, values);

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found or no changes made" });
    }

    res.json({ success: true, message: "Work details updated successfully" });
  } catch (error) {
    console.error("Error updating work details:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const updateUserLocation = async (req, res) => {
  const { userId, currentCity, hometown } = req.body;

  try {
    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "User ID is required" });
    }

    // Create an array to store fields to update
    const updates = [];
    const values = [];

    if (currentCity !== undefined) {
      updates.push("user_current_city = ?");
      values.push(currentCity);
    }
    if (hometown !== undefined) {
      updates.push("user_hometown= ?");
      values.push(hometown);
    }

    // If no fields are provided, return an error
    if (updates.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No fields to update" });
    }

    values.push(userId);

    // Build the SQL query dynamically
    const query = `UPDATE users SET ${updates.join(", ")} WHERE user_id = ?`;

    const [result] = await db.query(query, values);

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found or no changes made" });
    }

    res.json({
      success: true,
      message: "Location details updated successfully",
    });
  } catch (error) {
    console.error("Error updating Location details:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
const updateUserEducation = async (req, res) => {
  const { userId, school, major, grade } = req.body;

  try {
    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "User ID is required" });
    }

    // Create an array to store fields to update
    const updates = [];
    const values = [];

    if (school !== undefined) {
      updates.push("user_edu_school = ?");
      values.push(school);
    }
    if (major !== undefined) {
      updates.push("user_edu_major= ?");
      values.push(major);
    }
    if (grade !== undefined) {
      updates.push("user_edu_class= ?");
      values.push(grade);
    }

    // If no fields are provided, return an error
    if (updates.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No fields to update" });
    }

    values.push(userId);

    // Build the SQL query dynamically
    const query = `UPDATE users SET ${updates.join(", ")} WHERE user_id = ?`;

    const [result] = await db.query(query, values);

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found or no changes made" });
    }

    res.json({
      success: true,
      message: "Education details updated successfully",
    });
  } catch (error) {
    console.error("Error updating Education details:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

async function updatePasswordController(req, res) {
  console.log("🔹 Extracted userId from token:", req.userId || req.user?.id);
  if (!req.user?.id) {
    console.error("❌ Missing userId in request. Authentication issue?");
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }
  const userId = req.userId || req.user?.id;
  const { currentPassword, newPassword, confirmPassword } = req.body;
  console.log("userId:", userId); // Debugging
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: No user ID found in token",
    });
  }
  console.log("🔹 Full request userId:", userId); // Debugging

  if (!currentPassword || !newPassword || !confirmPassword) {
    return res
      .status(400)
      .json({ success: false, message: "All fields are required" });
  }

  if (newPassword !== confirmPassword) {
    return res
      .status(400)
      .json({ success: false, message: "New passwords do not match" });
  }

  try {
    console.log("🔍 Fetching user from database...");
    const [user] = await db.query(
      "SELECT user_password FROM users WHERE user_id = ?",
      [userId],
    );

    console.log("🛠️ Database response:", user);

    if (!user || user.length === 0) {
      console.error("❌ User not found in DB");
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const storedHashedPassword = user[0].user_password;
    console.log("🔑 Stored hashed password:", storedHashedPassword);
    console.log("🔍 Comparing entered password...");
    console.log("🔍 Current password:", currentPassword);

    const isMatch = await bcrypt.compare(currentPassword, storedHashedPassword);
    console.log("✅ bcrypt.compare() result:", isMatch);

    if (!isMatch) {
      console.error("❌ Incorrect current password");
      return res
        .status(401)
        .json({ success: false, message: "Incorrect current password" });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    console.log("🆕 Hashed new password:", hashedNewPassword);
    const result = await db.query(
      "UPDATE users SET user_password = ? WHERE user_id = ?",
      [hashedNewPassword, userId],
    );

    console.log("🔄 Update result:", result);

    console.log("✅ Password updated successfully for userId:", userId);
    return res
      .status(200)
      .json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    console.error("❌ Error updating password:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

// Add this to your userController.js
async function sendPasswordResetOTP(req, res) {
  const { email } = req.body;

  if (!email) {
    return res
      .status(400)
      .json({ success: false, message: "Email is required" });
  }

  try {
    // Check if user exists
    const [user] = await db.query("SELECT * FROM users WHERE user_email = ?", [
      email,
    ]);

    if (!user || user.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 15 * 60 * 1000); // OTP valid for 15 minutes

    // Store OTP in database (you might want a separate table for this)
    await db.query("UPDATE users SET user_reset_key = ? WHERE user_email = ?", [
      otp,
      email,
    ]);

    // Here you would send the OTP to the user's email
    console.log(`OTP for ${email}: ${otp}`); // Remove this in production

    return res.status(200).json({
      success: true,
      message: "OTP sent to email",
      // In production, don't send the OTP back in the response
      otp: otp, // For development/testing only
    });
  } catch (error) {
    console.error("Error sending OTP:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

async function verifyPasswordResetOTP(req, res) {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res
      .status(400)
      .json({ success: false, message: "Email and OTP are required" });
  }

  try {
    // Check if OTP matches and is not expired
    const [user] = await db.query(
      "SELECT * FROM users WHERE user_email = ? AND user_reset_key = ? ",
      [email, otp],
    );

    if (!user || user.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired OTP" });
    }

    // Generate a reset token (optional, if you want to use token-based verification)
    const resetToken = jwt.sign({ email }, process.env.JWT_SECRET, {
      expiresIn: "15m",
    });

    return res.status(200).json({
      success: true,
      message: "OTP verified",
      resetToken, // This can be used to authorize the password reset
    });
  } catch (error) {
    console.error("Error verifying OTP:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

async function resetPassword(req, res) {
  const { email, newPassword, confirmPassword } = req.body;

  if (!email || !newPassword || !confirmPassword) {
    return res
      .status(400)
      .json({ success: false, message: "All fields are required" });
  }

  if (newPassword !== confirmPassword) {
    return res
      .status(400)
      .json({ success: false, message: "Passwords do not match" });
  }

  try {
    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and clear OTP fields
    await db.query(
      "UPDATE users SET user_password = ?, user_reseted = 1, user_reset_key = NULL WHERE user_email = ?",
      [hashedPassword, email],
    );

    return res.status(200).json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (error) {
    console.error("Error resetting password:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

// ✅ Fetch all sessions for the logged-in user
const getUserSessions = async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch sessions correctly
    const [sessions] = await db.query(
      "SELECT session_id AS id, user_browser AS browser, user_os AS os FROM users_sessions WHERE user_id = ?",
      [userId],
    );

    console.log("✅ Clean Sessions Data:", sessions); // Debugging

    return res.status(200).json({ success: true, sessions }); // Flatten response
  } catch (error) {
    console.error("❌ Error fetching sessions:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ✅ Delete a specific session
const deleteSession = async (req, res) => {
  try {
    const userId = req.user?.id; // Get user ID from token
    const { sessionId } = req.params;

    const result = await db.query(
      "DELETE FROM users_sessions WHERE session_id = ? AND user_id = ?",
      [sessionId, userId],
    );

    if (result[0].affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Session not found" });
    }

    return res
      .status(200)
      .json({ success: true, message: "Session deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting session:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const enableTwoFactorAuth = async (req, res) => {
  const { userId } = req.body;

  try {
    // Generate a TOTP secret
    const secret = speakeasy.generateSecret({ length: 10 });
    console.log("Generated Secret:", secret.base32); // This is what should be stored in the DB

    // Save secret to database
    await db.query(
      "UPDATE users SET user_two_factor_gsecret = ?, user_two_factor_enabled = '0', user_two_factor_type = 'google' WHERE user_id = ?",
      [secret.base32, userId],
    );

    // Generate QR code for Google Authenticator
    const otpauthURL = `otpauth://totp/Pipitrent:${userId}?secret=${secret.base32}&issuer=Pipitrend`;
    const qrCode = await QRCode.toDataURL(otpauthURL);

    res.json({ success: true, qrCode, secret: secret.base32 });
  } catch (error) {
    console.error("Error enabling 2FA:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const verifyTwoFactorAuth = async (req, res) => {
  const { userId, token } = req.body;

  try {
    // Get the secret key from the database
    const [rows] = await db.query(
      "SELECT user_two_factor_gsecret FROM users WHERE user_id = ?",
      [userId],
    );

    if (!rows.length || !rows[0].user_two_factor_gsecret) {
      return res
        .status(400)
        .json({ success: false, message: "2FA not set up" });
    }

    const secret = rows[0].user_two_factor_gsecret;

    console.log("Stored secret:", secret);
    console.log("Received token:", token);

    // Verify the provided TOTP code with a slight time drift
    const isValid = speakeasy.totp.verify({
      secret,
      encoding: "base32",
      token: token.trim(), // Ensure no extra spaces
      window: 2, // Allow slight time drift (1-2 intervals)
    });

    if (!isValid) {
      return res.status(400).json({ success: false, message: "Invalid code" });
    }

    // Activate 2FA
    const [updateResult] = await db.query(
      "UPDATE users SET user_two_factor_enabled = '1', user_two_factor_type = 'google' WHERE user_id = ?",
      [userId],
    );

    console.log("Update result:", updateResult);

    res.json({ success: true, message: "2FA enabled successfully" });
  } catch (error) {
    console.error("Error verifying 2FA:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Check if 2FA is enabled for a user
const check2FAStatus = async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "User ID is required" });
    }

    // Query the database
    const [rows] = await db.execute(
      "SELECT user_id, user_two_factor_enabled FROM users WHERE user_id = ?",
      [userId],
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Log actual database result
    console.log("Database result:", rows[0]);

    // Ensure it’s a string before checking
    const is2FAEnabled = rows[0].user_two_factor_enabled === "1";

    return res.status(200).json({
      success: true,
      userId: rows[0].user_id,
      userTwoFactorEnabled: rows[0].user_two_factor_enabled, // Raw value
      is2FAEnabled: is2FAEnabled || false, // Ensures boolean response
    });
  } catch (error) {
    console.error("Error checking 2FA status:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

const disableTwoFactorAuth = async (req, res) => {
  const { userId } = req.body;

  try {
    // Update the database to disable 2FA
    await db.query(
      "UPDATE users SET user_two_factor_key = NULL, user_two_factor_gsecret = NULL, user_two_factor_enabled = '0', user_two_factor_type = NULL WHERE user_id = ?",
      [userId],
    );

    res.json({ success: true, message: "2FA disabled successfully" });
  } catch (error) {
    console.error("Error disabling 2FA:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const fetchUserSettings = async (req, res) => {
  const { userId } = req.query; // Assuming userId is passed as a query parameter

  if (!userId) {
    return res
      .status(400)
      .json({ success: false, message: "User ID is required" });
  }

  try {
    // Fetch user settings from the database
    const [rows] = await db.query(
      "SELECT chat_sound, notifications_sound FROM users WHERE user_id = ?",
      [userId],
    );

    if (!rows.length) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const user = rows[0]; // Get the first row

    // Return the settings
    res.json({
      success: true,
      chat_sound: user.chat_sound,
      notification_sound: user.notifications_sound, // Use the correct field name
    });
  } catch (error) {
    console.error("Error fetching user settings:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const updateUserSettings = async (req, res) => {
  const { userId, chat_sound, notification_sound } = req.body;

  if (!userId || chat_sound === undefined || notification_sound === undefined) {
    return res.status(400).json({
      success: false,
      message: "User ID, chat_sound, and notification_sound are required",
    });
  }

  try {
    // Update the user's settings in the database
    await db.query(
      "UPDATE users SET chat_sound = ?, notifications_sound = ? WHERE user_id = ?",
      [chat_sound ? "1" : "0", notification_sound ? "1" : "0", userId],
    );
    // Fetch the updated settings to return them in the response
    const [rows] = await db.query(
      "SELECT chat_sound, notifications_sound FROM users WHERE user_id = ?",
      [userId],
    );

    if (!rows.length) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const user = rows[0];

    res.json({
      success: true,
      message: "User settings updated successfully",
      chat_sound: user.chat_sound,
      notification_sound: user.notifications_sound,
    });
  } catch (error) {
    console.error("Error updating user settings:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(`Received request to delete user with ID: ${userId}`);

    // Check if the user exists
    const [user] = await db.query(
      "SELECT user_id FROM users WHERE user_id = ?",
      [userId],
    );

    if (!user.length) {
      console.warn(`User with ID ${userId} not found.`);
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    console.log(`User with ID ${userId} found. Proceeding with deletion...`);

    // Delete the user
    await db.query("DELETE FROM users WHERE user_id = ?", [userId]);

    console.log(`User with ID ${userId} deleted successfully.`);
    res
      .status(200)
      .json({ success: true, message: "User account deleted successfully." });
  } catch (error) {
    console.error(`Error deleting user with ID ${req.params.userId}:`, error);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
};

function authenticateUser(req, res, next) {
  console.log("authenticateUser: Processing request", {
    method: req.method,
    url: req.originalUrl,
    headers: req.headers,
    timestamp: new Date().toISOString(),
  });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.error(
      "authenticateUser: Missing or malformed Authorization header",
      { authHeader },
    );
    return res
      .status(401)
      .json({ error: "Unauthorized: Missing or malformed token" });
  }

  const token = authHeader.split(" ")[1];
  console.log("authenticateUser: Extracted token", { token });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("authenticateUser: Token decoded successfully", { decoded });
    req.user = decoded;
    next();
  } catch (error) {
    console.error("authenticateUser: JWT verification failed", {
      error: error.message,
      name: error.name,
      token,
    });
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Unauthorized: Token expired" });
    }
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
}

async function getUserProfiles(req, res) {
  console.log("getUserProfiles: Starting request", {
    authenticatedUserId: req.user?.id,
    targetUserId: req.params.userId,
    timestamp: new Date().toISOString(),
  });

  const { userId } = req.params;
  const currentUserId = req.user?.id;

  // ——— 1. Validate userId param ———
  const schema = Joi.object({
    userId: Joi.number().integer().positive().required(),
  });

  const { error } = schema.validate({ userId: parseInt(userId, 10) });
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const targetUserId = parseInt(userId, 10);

  // ——— 2. Require authentication ———
  if (!currentUserId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    // ——— 3. Fetch profile with privacy rules ———
    const profile = await getUserProfile(targetUserId, currentUserId);

    if (!profile) {
      return res.status(404).json({ error: "User not found" });
    }

    console.log("getUserProfiles: Success", {
      targetUserId,
      viewerId: currentUserId,
    });
    res.json({ success: true, data: profile });
  } catch (error) {
    console.error("getUserProfiles: Database error", {
      error: error.message,
      sql: error.sql,
      targetUserId,
      currentUserId,
    });
    res.status(500).json({ error: "Failed to fetch profile" });
  }
}

// controllers/dataRequestController.js

const requestUserData = async (req, res) => {
  const { userId, items } = req.body;

  // Validation
  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "User ID is required",
    });
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Please select at least one item to download",
    });
  }

  try {
    // Get user info
    const [userRows] = await db.query(
      "SELECT user_email, user_name FROM users WHERE user_id = ?",
      [userId],
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const { user_email, user_name } = userRows[0];
    const requestedItems = items.join(", ");

    // Save request to database (optional but recommended)
    await db.query(
      `INSERT INTO data_requests 
        (user_id, requested_items, status, requested_at) 
        VALUES (?, ?, 'pending', NOW())`,
      [userId, requestedItems],
    );

    // Send emails: to admin (you) + auto-reply to user
    const emailsSent = await sendDataRequestEmails(
      user_email,
      user_name || "User",
      userId,
      items,
    );

    if (!emailsSent) {
      console.warn("Data request saved, but emails failed to send");
      // Still return success — request is logged
    }

    return res.json({
      success: true,
      message: "Request received! We'll prepare your data and email you soon.",
    });
  } catch (error) {
    console.error("Error in requestUserData:", error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
};

// Add this function to your userController.js

// SEARCH USERS (for adding to groups)
const searchUsers = async (req, res) => {
  try {
    const { query = "", limit = 20, excludeGroupId = null } = req.query;
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Build search conditions
    let whereClauses = ["u.user_id != ?"];
    const values = [currentUserId];

    if (query) {
      whereClauses.push(
        "(u.user_name LIKE ? OR u.user_firstname LIKE ? OR u.user_lastname LIKE ?)",
      );
      const searchTerm = `%${query}%`;
      values.push(searchTerm, searchTerm, searchTerm);
    }

    // If excludeGroupId is provided, exclude users already in that group
    if (excludeGroupId) {
      whereClauses.push(
        `NOT EXISTS (
          SELECT 1 FROM groups_members gm 
          WHERE gm.user_id = u.user_id 
          AND gm.group_id = ?
        )`,
      );
      values.push(excludeGroupId);
    }

    // Get users with basic info
    const [users] = await db.query(
      `SELECT 
        u.user_id,
        u.user_name,
        u.user_firstname,
        u.user_lastname,
        u.user_picture,
        u.user_verified,
        u.user_last_seen,
        u.user_email,
        (SELECT COUNT(*) FROM friends f 
         WHERE (f.user_one_id = u.user_id OR f.user_two_id = u.user_id) 
         AND f.status = 1) as friend_count,
        (SELECT 1 FROM friends f 
         WHERE ((f.user_one_id = u.user_id AND f.user_two_id = ?) 
                OR (f.user_one_id = ? AND f.user_two_id = u.user_id))
         AND f.status = 1) as is_friend
       FROM users u
       WHERE ${whereClauses.join(" AND ")}
       ORDER BY 
         CASE 
           WHEN u.user_firstname LIKE ? THEN 1
           WHEN u.user_lastname LIKE ? THEN 2
           WHEN u.user_name LIKE ? THEN 3
           ELSE 4
         END,
         u.user_firstname, u.user_lastname
       LIMIT ?`,
      [
        ...values,
        currentUserId,
        currentUserId,
        query ? `%${query}%` : "",
        query ? `%${query}%` : "",
        query ? `%${query}%` : "",
        parseInt(limit),
      ],
    );

    // Process user data
    const processedUsers = users.map((user) => ({
      user_id: user.user_id,
      user_name: user.user_name,
      user_firstname: user.user_firstname,
      user_lastname: user.user_lastname,
      user_picture: user.user_picture || null,

      user_verified: user.user_verified === "1",
      user_last_seen: user.user_last_seen,
      is_friend: user.is_friend === 1,
      friend_count: user.friend_count || 0,
      display_name: user.user_firstname
        ? `${user.user_firstname} ${user.user_lastname || ""}`.trim()
        : user.user_name,
    }));

    res.json({
      success: true,
      data: {
        users: processedUsers,
        total: processedUsers.length,
        search_query: query,
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Error searching users:", error);
    res.status(500).json({
      success: false,
      message: "Failed to search users",
    });
  }
};

// OPTIONAL: Search users who are not in a specific group (for group invitations)
const searchUsersNotInGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { query = "", limit = 20 } = req.query;
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!groupId) {
      return res.status(400).json({
        success: false,
        message: "Group ID is required",
      });
    }

    // Verify user has permission to add members to this group
    const [groupCheck] = await db.query(
      `SELECT 1 FROM groups_admins WHERE group_id = ? AND user_id = ?`,
      [groupId, currentUserId],
    );

    if (groupCheck.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Only group admins can search for users to add",
      });
    }

    // Build search query
    let whereClauses = ["u.user_id != ?"];
    const values = [currentUserId];

    // Exclude users already in the group
    whereClauses.push(
      `NOT EXISTS (
        SELECT 1 FROM groups_members gm 
        WHERE gm.user_id = u.user_id 
        AND gm.group_id = ?
      )`,
    );
    values.push(groupId);

    // Check membership status
    const isInGroupSelect = `(
      SELECT 1 FROM groups_members gm2 
      WHERE gm2.group_id = ? AND gm2.user_id = u.user_id
    ) as is_in_group`;
    values.push(groupId);

    // Add search query
    if (query) {
      whereClauses.push(
        "(u.user_name LIKE ? OR u.user_firstname LIKE ? OR u.user_lastname LIKE ?)",
      );
      const searchTerm = `%${query}%`;
      values.push(searchTerm, searchTerm, searchTerm);
    }

    // Build ORDER BY clause
    let orderByClause = "u.user_firstname";
    if (query) {
      // Add values for CASE statement
      values.push(`%${query}%`, `%${query}%`, `%${query}%`);
      orderByClause = `
        CASE 
          WHEN u.user_firstname LIKE ? THEN 1
          WHEN u.user_lastname LIKE ? THEN 2
          WHEN u.user_name LIKE ? THEN 3
          ELSE 4
        END,
        u.user_firstname
      `;
    }

    // Get users
    const [users] = await db.query(
      `SELECT 
        u.user_id,
        u.user_name,
        u.user_firstname,
        u.user_lastname,
        u.user_picture,
        u.user_verified,
        ${isInGroupSelect},
        (SELECT 1 FROM friends f 
         WHERE ((f.user_one_id = u.user_id AND f.user_two_id = ?) 
                OR (f.user_one_id = ? AND f.user_two_id = u.user_id))
         AND f.status = 1) as is_friend
       FROM users u
       WHERE ${whereClauses.join(" AND ")}
       ORDER BY ${orderByClause}
       LIMIT ?`,
      [...values, currentUserId, currentUserId, parseInt(limit)],
    );

    // Process results
    const processedUsers = users.map((user) => ({
      user_id: user.user_id,
      user_name: user.user_name,
      user_firstname: user.user_firstname,
      user_lastname: user.user_lastname,
      user_picture: user.user_picture || null,

      user_verified: user.user_verified === "1",
      is_in_group: user.is_in_group === 1,
      is_friend: user.is_friend === 1,
      display_name: user.user_firstname
        ? `${user.user_firstname} ${user.user_lastname || ""}`.trim()
        : user.user_name,
    }));

    res.json({
      success: true,
      data: {
        users: processedUsers,
        total: processedUsers.length,
        group_id: groupId,
        search_query: query,
      },
    });
  } catch (error) {
    console.error("Error searching users not in group:", error);
    res.status(500).json({
      success: false,
      message: "Failed to search users",
    });
  }
};

// OPTIONAL: Get user suggestions for group invitations
const getUserSuggestions = async (req, res) => {
  try {
    const currentUserId = req.user?.id;
    const { groupId, limit = 10 } = req.query;

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Get user's friends who are not in the group (if groupId provided)
    let whereClause =
      "f.status = 1 AND (f.user_one_id = ? OR f.user_two_id = ?)";
    const values = [currentUserId, currentUserId];

    if (groupId) {
      whereClause += ` AND NOT EXISTS (
        SELECT 1 FROM groups_members gm 
        WHERE gm.user_id = (
          CASE 
            WHEN f.user_one_id = ? THEN f.user_two_id
            ELSE f.user_one_id
          END
        ) 
        AND gm.group_id = ?
      )`;
      values.push(currentUserId, groupId);
    }

    const [friends] = await db.query(
      `SELECT 
        u.user_id,
        u.user_name,
        u.user_firstname,
        u.user_lastname,
        u.user_picture,
        u.user_verified,
        COUNT(DISTINCT mu.id) as mutual_friends
       FROM friends f
       JOIN users u ON u.user_id = (
         CASE 
           WHEN f.user_one_id = ? THEN f.user_two_id
           ELSE f.user_one_id
         END
       )
       LEFT JOIN friends mu ON (
         (mu.user_one_id = u.user_id OR mu.user_two_id = u.user_id)
         AND mu.status = 1
         AND (mu.user_one_id != ? AND mu.user_two_id != ?)
       )
       WHERE ${whereClause}
       GROUP BY u.user_id
       ORDER BY mutual_friends DESC, u.user_last_seen DESC
       LIMIT ?`,
      [currentUserId, currentUserId, currentUserId, ...values, parseInt(limit)],
    );

    const processedFriends = friends.map((friend) => ({
      user_id: friend.user_id,
      user_name: friend.user_name,
      user_firstname: friend.user_firstname,
      user_lastname: friend.user_lastname,
      user_picture: user.user_picture || null,

      user_verified: friend.user_verified === "1",
      mutual_friends: friend.mutual_friends,
      display_name: friend.user_firstname
        ? `${friend.user_firstname} ${friend.user_lastname || ""}`.trim()
        : friend.user_name,
    }));

    res.json({
      success: true,
      data: {
        suggestions: processedFriends,
        total: processedFriends.length,
        group_id: groupId || null,
      },
    });
  } catch (error) {
    console.error("Error getting user suggestions:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get suggestions",
    });
  }
};

// Get user online status based on last_seen timestamp
const getOnlineStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const ONLINE_THRESHOLD = 5 * 60 * 1000; // 5 minutes in milliseconds

    const query =
      "SELECT user_id, user_last_seen, user_firstname, user_lastname FROM users WHERE user_id = ?";
    const results = await db.query(query, [userId]);

    if (!results || results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = results[0];
    const lastSeenTime = new Date(user.user_last_seen).getTime();
    const currentTime = new Date().getTime();
    const timeDiffMs = currentTime - lastSeenTime;

    const isOnline = timeDiffMs < ONLINE_THRESHOLD;
    const lastSeenDate = new Date(user.user_last_seen);

    res.status(200).json({
      success: true,
      data: {
        user_id: user.user_id,
        is_online: isOnline,
        last_seen: user.user_last_seen,
        user_name: `${user.user_firstname} ${user.user_lastname || ""}`.trim(),
      },
    });
  } catch (error) {
    console.error("Error getting online status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get online status",
    });
  }
};

module.exports = {
  showRandomUsers,
  updateUserEmail,
  requestUserData,
  getUserNames,
  updateUserProfileController,
  uploadProfilePictureController,
  getCountryController,
  getCountries,
  updateUserDetails,
  verifyEmailChange,
  checkUsernameAvailability,
  updateUserWork,
  updateUserLocation,
  updateUserEducation,
  uploadCoverPictureController,
  updatePasswordController,
  getUserSessions,
  deleteSession,
  enableTwoFactorAuth,
  verifyTwoFactorAuth,
  check2FAStatus,
  disableTwoFactorAuth,
  fetchUserSettings,
  updateUserSettings,
  deleteUser,
  getUserProfiles,
  authenticateUser,
  verifyPasswordController,
  searchUsers,
  searchUsersNotInGroup,
  getUserSuggestions,
  getOnlineStatus,
};
