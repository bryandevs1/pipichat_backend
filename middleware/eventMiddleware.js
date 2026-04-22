// middleware/eventsMiddleware.js
const EventsController = require("../controllers/eventsController");

const checkEventAdmin = async (req, res, next) => {
  try {
    const eventId = req.params.eventId;
    const userId = EventsController.getCurrentUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const isAdmin = await EventsController.isUserAdmin(eventId, userId);
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Only event admins can perform this action",
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

const checkEventMember = async (req, res, next) => {
  try {
    const eventId = req.params.eventId;
    const userId = EventsController.getCurrentUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const isMember = await EventsController.isUserMember(eventId, userId);
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You must be a member of this event",
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

const checkEventAccess = async (req, res, next) => {
  try {
    const eventId = req.params.eventId;
    const userId = EventsController.getCurrentUserId(req);

    const canAccess = await EventsController.checkEventPrivacy(eventId, userId);
    if (!canAccess) {
      return res.status(403).json({
        success: false,
        message: "You don't have access to this event",
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  checkEventAdmin,
  checkEventMember,
  checkEventAccess,
};


