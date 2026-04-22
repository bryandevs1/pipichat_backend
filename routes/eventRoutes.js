// routes/events.js

const express = require("express");
const multer = require("multer");

const router = express.Router();

const EventsController = require("../controllers/eventsController");
const { authenticateToken } = require("../middleware/authMiddleware");

/* ======================================================
   MULTER CONFIG
====================================================== */

const storage = multer.memoryStorage();

const eventUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"), false);
  },
});

const postUpload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
});

/* ======================================================
   ✅ PUBLIC ROUTES (NO AUTH REQUIRED)
====================================================== */

// Categories
router.get("/categories", EventsController.getEventCategories);
router.get(
  "/categories/:categoryId/events",
  EventsController.getEventsByCategory,
);

// Search & Filters
router.get("/search", EventsController.searchEvents);
router.get("/filter/upcoming", EventsController.getUpcomingEvents);
router.get("/filter/past", EventsController.getPastEvents);
router.get("/filter/featured", EventsController.getFeaturedEvents);

// Get all events
router.get("/", EventsController.getAllEvents);

// Get single event
router.get("/:eventId", EventsController.getEventById);

// Get event posts
router.get("/:eventId/posts", EventsController.getEventPosts);

// Get event members
router.get("/:eventId/members", EventsController.getEventMembers);

// Get event stats
router.get("/:eventId/stats", EventsController.getEventStats);

// Tickets & pricing
router.get("/:eventId/tickets", EventsController.getEventTickets);
router.get("/:eventId/prices", EventsController.getEventPrices);

/* ======================================================
   🔐 PROTECTED ROUTES (AUTH REQUIRED)
====================================================== */

// Create event
router.post(
  "/",
  authenticateToken,
  eventUpload.fields([{ name: "event_cover", maxCount: 1 }]),
  EventsController.createEvent,
);

// Update event
router.put(
  "/:eventId",
  authenticateToken,
  eventUpload.fields([{ name: "event_cover", maxCount: 1 }]),
  EventsController.updateEvent,
);

// Delete event
router.delete("/:eventId", authenticateToken, EventsController.deleteEvent);

// Create event post
router.post(
  "/:eventId/posts",
  authenticateToken,
  postUpload.fields([
    { name: "photos", maxCount: 10 },
    { name: "video", maxCount: 1 },
    { name: "audio", maxCount: 1 },
    { name: "file", maxCount: 1 },
  ]),
  EventsController.createPost,
);

// Delete post
router.delete(
  "/:eventId/posts/:postId",
  authenticateToken,
  EventsController.deletePost,
);

// Membership actions
router.post(
  "/:eventId/invite/:userId",
  authenticateToken,
  EventsController.inviteToEvent,
);

router.post(
  "/:eventId/respond",
  authenticateToken,
  EventsController.respondToInvitation,
);

router.delete(
  "/:eventId/members/:userId",
  authenticateToken,
  EventsController.removeMember,
);

// Admin actions
router.post(
  "/:eventId/admins/:userId",
  authenticateToken,
  EventsController.makeAdmin,
);

router.delete(
  "/:eventId/admins/:userId",
  authenticateToken,
  EventsController.removeAdmin,
);

// Interactions
router.post(
  "/:eventId/interested",
  authenticateToken,
  EventsController.markInterested,
);

router.post("/:eventId/going", authenticateToken, EventsController.markGoing);

// Reporting
router.post(
  "/:eventId/report",
  authenticateToken,
  EventsController.reportEvent,
);

// Verification
router.post(
  "/:eventId/request-verification",
  authenticateToken,
  EventsController.requestVerification,
);

module.exports = router;
