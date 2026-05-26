// config/db.js
const mysql = require("mysql2/promise");
require("dotenv").config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Add transaction helper methods
pool.beginTransaction = async () => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  return connection;
};

pool.commit = async (connection) => {
  await connection.commit();
  connection.release();
};

pool.rollback = async (connection) => {
  await connection.rollback();
  connection.release();
};

// Test the database connection
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log("Connected to database.");
    connection.release();
  } catch (err) {
    console.error("Database connection failed:", err.stack);
  }
}

testConnection();

module.exports = pool;
