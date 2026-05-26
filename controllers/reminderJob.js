// jobs/reminderJob.js
const cron = require("node-cron");
const ActivityLogger = require("../services/activityLogger");
const pool = require("../config/db");

// Run every hour to check for upcoming events
cron.schedule("0 * * * *", async () => {
  try {
    // Get events starting in the next 2 hours
    const [events] = await pool.query(
      `SELECT event_id FROM events 
       WHERE event_start_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 2 HOUR)
       AND event_reminder_sent = '0'`
    );

    for (const event of events) {
      await ActivityLogger.sendEventReminder(event.event_id, 60); // 60 min reminder

      // Mark reminder as sent
      await pool.query(
        "UPDATE events SET event_reminder_sent = '1' WHERE event_id = ?",
        [event.event_id]
      );
    }
  } catch (error) {
    console.error("Reminder job error:", error);
  }
});
