const db = require("../config/db"); // Assuming you have a database connection file

exports.makeWithdrawal = async (req, res) => {
  try {
    const { user_id, amount, method, method_value } = req.body;

    // Validate input
    if (!user_id || !amount || !method || !method_value) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (amount < 100) {
      return res.status(400).json({ error: "Minimum withdrawal is 100 NGN" });
    }

    // Correct SQL query
    const query = `
      INSERT INTO points_payments (user_id, amount, method, method_value, time, status)
      VALUES (?, ?, ?, ?, NOW(), 0)
    `;

    await db.query(query, [user_id, amount, method, method_value]);

    res
      .status(200)
      .json({ message: "Withdrawal request submitted successfully" });
  } catch (error) {
    console.error("Withdrawal Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.fundingWithdrawal = async (req, res) => {
  try {
    const { user_id, amount, method, method_value } = req.body;

    // Validate input
    if (!user_id || !amount || !method || !method_value) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (amount < 100) {
      return res.status(400).json({ error: "Minimum withdrawal is 100 NGN" });
    }

    // Correct SQL query
    const query = `
      INSERT INTO funding_payments (user_id, amount, method, method_value, time, status)
      VALUES (?, ?, ?, ?, NOW(), 0)
    `;

    await db.query(query, [user_id, amount, method, method_value]);

    res
      .status(200)
      .json({ message: "Withdrawal request submitted successfully" });
  } catch (error) {
    console.error("Withdrawal Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
