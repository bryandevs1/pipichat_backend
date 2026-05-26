const express = require("express");
const router = express.Router();
const blockController = require("../controllers/blockController");

router.post("/block/:user_id", blockController.blockUser);
router.delete("/unblock/:user_id/:blocked_id", blockController.unblockUser);
router.get("/blocked/:user_id", blockController.getBlockedUsers);

module.exports = router;
