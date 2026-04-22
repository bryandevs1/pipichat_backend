const express = require("express");
const router = express.Router();
const {
  sendFriendRequest,
  updateFriendStatus,
  getFriends,
  removeFriend,
  authenticateUser,
  getSuggestedPeople,
  getFriendRequests,
  getSentRequests,
  getUsersBySearch,
  getUserProfile,
  getFriendStatus,
  getFollowing,
  getFollowers, // Add new controller function
} = require("../controllers/friendsController");
const { authenticateToken } = require("../middleware/authMiddleware");

// Apply authentication to all routes
router.use(authenticateToken);

// SPECIFIC ROUTES FIRST (in order of specificity)
router.get(
  "/requests",
  (req, res, next) => {
    console.log("friendsRoutes: Handling GET /api/friends/requests", {
      method: req.method,
      url: req.originalUrl,
      user: req.user,
      query: req.query,
      timestamp: new Date().toISOString(),
    });
    next();
  },
  getFriendRequests,
);

router.get(
  "/requests/sent",
  (req, res, next) => {
    console.log("friendsRoutes: Handling GET /api/friends/requests/sent", {
      method: req.method,
      url: req.originalUrl,
      user: req.user,
      query: req.query,
      timestamp: new Date().toISOString(),
    });
    next();
  },
  getSentRequests,
);

router.get(
  "/users/suggested",
  (req, res, next) => {
    console.log("friendsRoutes: Handling GET /api/friends/users/suggested", {
      method: req.method,
      url: req.originalUrl,
      user: req.user,
      query: req.query,
      timestamp: new Date().toISOString(),
    });
    next();
  },
  getSuggestedPeople,
);

router.get(
  "/search",
  (req, res, next) => {
    console.log("friendsRoutes: Handling GET /api/friends/search", {
      method: req.method,
      url: req.originalUrl,
      user: req.user,
      query: req.query,
      timestamp: new Date().toISOString(),
    });
    next();
  },
  getUsersBySearch,
);

// -----------------------------------------------------------------
//  FOLLOWERS & FOLLOWING (under /api/friends)
// -----------------------------------------------------------------
router.get(
  "/:userId/followers",
  authenticateUser,
  (req, res, next) => {
    console.log("GET /api/friends/:userId/followers", {
      userId: req.params.userId,
      query: req.query,
    });
    next();
  },
  getFollowers,
);

router.get(
  "/:userId/following",
  authenticateUser,
  (req, res, next) => {
    console.log("GET /api/friends/:userId/following", {
      userId: req.params.userId,
      query: req.query,
    });
    next();
  },
  getFollowing,
);

router.get(
  "/profile/:userId",
  (req, res, next) => {
    console.log("friendsRoutes: Handling GET /api/friends/profile/:userId", {
      method: req.method,
      url: req.originalUrl,
      user: req.user,
      params: req.params,
      timestamp: new Date().toISOString(),
    });
    next();
  },
  getUserProfile,
);

// PARAMETERIZED ROUTES LAST
router.get(
  "/:userId",
  (req, res, next) => {
    console.log("friendsRoutes: Handling GET /api/friends/:userId", {
      method: req.method,
      url: req.originalUrl,
      user: req.user,
      params: req.params,
      timestamp: new Date().toISOString(),
    });
    next();
  },
  getFriends,
);

router.post(
  "/request",
  (req, res, next) => {
    console.log("friendsRoutes: Handling POST /api/friends/request", {
      method: req.method,
      url: req.originalUrl,
      user: req.user,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    next();
  },
  sendFriendRequest,
);

router.put(
  "/request/:id",
  (req, res, next) => {
    console.log("friendsRoutes: Handling PUT /api/friends/request/:id", {
      method: req.method,
      url: req.originalUrl,
      user: req.user,
      params: req.params,
      timestamp: new Date().toISOString(),
    });
    next();
  },
  updateFriendStatus,
);
router.get("/status/:userId", authenticateUser, getFriendStatus);

router.delete(
  "/request/:id",
  (req, res, next) => {
    console.log("friendsRoutes: Handling DELETE /api/friends/request/:id", {
      method: req.method,
      url: req.originalUrl,
      user: req.user,
      params: req.params,
      timestamp: new Date().toISOString(),
    });
    next();
  },
  removeFriend,
);

module.exports = router;
