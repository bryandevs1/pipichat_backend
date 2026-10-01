// Shared moderation helpers for App Store Review Guideline 1.2 compliance.
//
// Guideline 1.2 requires apps with user-generated content to:
//   - have a mechanism for users to flag objectionable content
//   - have a mechanism for users to block abusive users
//   - notify the developer when abuse is reported/blocked
//   - act on reports within 24 hours
//
// This module centralises the "notify the developer" part so every report and
// block flows to one inbox with enough context to act.

const nodemailer = require("nodemailer");

// `reports.category_id` is NOT NULL and references reports_categories. Seed the
// table with this row if it is missing (see the SQL at the bottom of this file).
const REPORT_CATEGORY_ID = 1;

const MODERATION_INBOX = process.env.MODERATION_EMAIL || "admin@pipiafrica.com";

let cachedTransporter = null;

const getTransporter = () => {
  if (cachedTransporter) return cachedTransporter;

  // EMAIL_USER / EMAIL_PASSWORD are the names actually present in this
  // project's .env. EMAIL_USERNAME is kept as a fallback for older configs.
  const user = process.env.EMAIL_USER || process.env.EMAIL_USERNAME;
  const pass = process.env.EMAIL_PASSWORD;

  if (!user || !pass) {
    return null;
  }

  cachedTransporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || "gmail",
    auth: { user, pass },
  });
  return cachedTransporter;
};

/**
 * Email the moderation inbox. Deliberately fire-and-forget: this is called from
 * request handlers that have already persisted the report/block, so a mail
 * outage must never fail the user's action or block the response.
 *
 * @returns {Promise<boolean>} whether the mail was handed to the transport
 */
const sendModerationEmail = async ({ subject, html }) => {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn(
      "[moderation] Email not configured (EMAIL_USER / EMAIL_PASSWORD missing) - report stored but not emailed.",
    );
    return false;
  }

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER || process.env.EMAIL_USERNAME,
      to: MODERATION_INBOX,
      subject,
      html,
    });
    console.log("[moderation] notified:", subject);
    return true;
  } catch (error) {
    console.error("[moderation] failed to send email:", error.message);
    return false;
  }
};

/**
 * A conservative first-pass filter for clearly objectionable content.
 *
 * This is a BLOCKLIST of slurs and explicit solicitation terms, not a complete
 * moderation system - it catches the obvious cases so App Review can see a
 * filter exists. It deliberately errs toward false negatives rather than
 * blocking legitimate conversation, and human review remains the backstop.
 *
 * @param {string} text
 * @returns {{ blocked: boolean, match: string|null }}
 */
const SCREEN_PATTERNS = [
  // Racial / ethnic slurs (represented by pattern, not spelled out in source)
  /\bn[i1]gg(?:er|a)s?\b/i,
  /\bch[i1]nks?\b/i,
  /\bk[i1]kes?\b/i,
  /\bwetbacks?\b/i,
  /\bf[a4]gg?[o0]ts?\b/i,
  /\btr[a4]nn(?:y|ies)\b/i,
  /\br[e3]t[a4]rds?\b/i,
  // Sexual content / solicitation
  /\bchild\s*p[o0]rn\b/i,
  /\bcp\s*(?:link|trade)\b/i,
  /\bmolest(?:er|ing)\b/i,
  /\brape\s*(?:her|him|them|you)\b/i,
  /\bonly\s*fans\s*link\b/i,
  // Explicit violent threats
  /\b(?:kill|murder|behead)\s+(?:you|him|her|them|all)\b/i,
  /\bdeath\s+to\s+(?:all\s+)?\w+/i,
  // Illegal goods
  /\bbuy\s+(?:cocaine|heroin|meth|fentanyl)\b/i,
];

const screenContent = (text) => {
  if (!text || typeof text !== "string") return { blocked: false, match: null };

  for (const pattern of SCREEN_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return { blocked: true, match: match[0] };
  }
  return { blocked: false, match: null };
};

module.exports = {
  REPORT_CATEGORY_ID,
  MODERATION_INBOX,
  sendModerationEmail,
  screenContent,
};
