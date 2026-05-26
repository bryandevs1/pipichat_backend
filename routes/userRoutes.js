const express = require("express");
const {
  updateUserProfileController,
  uploadProfilePictureController,
  getCountryController,
  getCountries,
} = require("../controllers/userController");
const upload = require("../middleware/upload"); // Middleware for handling file uploads
const {
  authenticateToken,
  authenticateUser,
} = require("../middleware/authMiddleware");
const userController = require("../controllers/userController");
const { getUserProfiles } = require("../controllers/userController");

const router = express.Router();

// Route to update user profile
router.put("/update-profile", authenticateToken, updateUserProfileController);

// Route to upload profile picture
router.post(
  "/upload-picture",
  authenticateToken, // Ensure the token is validated before uploading the file
  upload.single("picture"), // Handle the file upload
  uploadProfilePictureController // Your controller to process the upload
);
router.get("/random-users", authenticateToken, userController.showRandomUsers);
router.post("/getUserNames", userController.getUserNames);

// Route to get country by ID
router.get("/country/:countryId", getCountryController);
router.get("/countries", getCountries);
router.put("/updateacctinfo/:userId", userController.updateUserDetails);

router.post("/verify-email", userController.verifyEmailChange);
router.get(
  "/check-username/:username",
  userController.checkUsernameAvailability
);
router.put("/update-work", userController.updateUserWork);
router.put("/update-location", userController.updateUserLocation);
router.put("/update-education", userController.updateUserEducation);
router.post(
  "/upload-cover-picture",
  authenticateToken, // Ensure the token is validated before uploading the file
  upload.single("picture"), // Handle the file upload
  userController.uploadCoverPictureController // Your controller to process the upload
);
router.post("/request-data", userController.requestUserData);
router.post(
  "/change-password",
  (req, res, next) => {
    console.log("🔵 Route hit: /api/users/change-password");
    next();
  },
  authenticateToken,
  userController.updatePasswordController
);

router.get("/sessions", authenticateToken, userController.getUserSessions);

// ✅ Delete a specific session by ID
router.delete(
  "/sessions/:sessionId",
  authenticateToken,
  userController.deleteSession
);

router.post("/enable-2fa", userController.enableTwoFactorAuth);
router.post("/verify-2fa", userController.verifyTwoFactorAuth);
router.get("/check-2fa", userController.check2FAStatus);
router.post("/disable-2fa", userController.disableTwoFactorAuth);
router.get("/settings", userController.fetchUserSettings);

// Update user settings
router.post("/update-settings", userController.updateUserSettings);
router.delete("/delete/:userId", userController.deleteUser);
// Route to fetch user profile by userId
router.get(
  "/profile/:userId",
  authenticateUser,
  (req, res, next) => {
    console.log("usersRoutes: Handling GET /api/users/profile/:userId", {
      method: req.method,
      url: req.originalUrl,
      user: req.user,
      params: req.params,
      timestamp: new Date().toISOString(),
    });
    next();
  },
  getUserProfiles
);

router.get(
  "/search",
  userController.authenticateUser,
  userController.searchUsers
);

// Search users not in a specific group (for group invitations)
router.get(
  "/search/not-in-group/:groupId",
  userController.authenticateUser,
  userController.searchUsersNotInGroup
);

// Get user suggestions (friends who might be interested)
router.get(
  "/suggestions",
  userController.authenticateUser,
  userController.getUserSuggestions
);

// Get user online status (no auth needed - relies on user_last_seen timestamp)
router.get("/online-status/:userId", userController.getOnlineStatus);

module.exports = router;
