const express = require("express");
const router = express.Router();
const ChatController = require("../controllers/chatController");
const { authenticateToken } = require("../middleware/authMiddleware");
const upload = require("../middleware/multer");
// Apply auth middleware to all routes
router.use(authenticateToken);

// Specific routes first (before :user_id parameter route)
router.post("/create", ChatController.createConversation);
router.get("/unread/count", ChatController.getUnreadCount);

// Conversation routes
router.get("/:user_id", ChatController.getUserConversations);
router.get("/with/:target_user_id", ChatController.getConversationWithUser);
router.delete("/:conversation_id", ChatController.deleteConversation);

// Message routes
router.get(
  "/:conversation_id/messages",
  ChatController.getConversationMessages,
);
router.post(
  "/:conversation_id/messages",
  upload.single("file"), // This is the field name from frontend
  ChatController.sendMessage,
);
router.put("/:conversation_id/seen", ChatController.markMessagesAsSeen);
router.put("/:conversation_id/typing", ChatController.updateTypingStatus);

// Search and utilities
router.get("/:conversation_id/search", ChatController.searchMessages);

module.exports = router;
