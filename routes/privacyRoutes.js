const express = require("express");
const router = express.Router();
const privacyController = require("../controllers/privacyController");

router.get("/:user_id", privacyController.getPrivacySettings);
router.put("/:user_id", privacyController.updatePrivacySettings);

module.exports = router;
