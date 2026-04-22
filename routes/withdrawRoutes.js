const express = require("express");
const router = express.Router();
const { makeWithdrawal } = require("../controllers/withdrawalController");

router.post("/points", makeWithdrawal);
router.post("/funding", makeWithdrawal);

module.exports = router;
