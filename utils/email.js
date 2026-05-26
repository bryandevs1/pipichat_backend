// utils/email.js
const nodemailer = require("nodemailer");

// === ZOHO MAIL SMTP CONFIGURATION ===
const transporter = nodemailer.createTransport({
  host: "smtp.zoho.com",
  port: 465, // Recommended: STARTTLS
  secure: true, // false for port 587 (true only if using port 465)
  auth: {
    user: process.env.EMAIL_USERNAME, // e.g., no-reply@pipiafrica.com
    pass: process.env.EMAIL_PASSWORD, // Zoho password or Application-Specific Password
  },
  tls: {
    rejectUnauthorized: false, // Helps during development; can be removed in production
  },
});

// Optional alternative using SSL (port 465):
// port: 465,
// secure: true,

// Verify SMTP connection on startup (good for catching config issues early)
transporter.verify((error, success) => {
  if (error) {
    console.error("SMTP Connection Error (Zoho):", error.message);
  } else {
    console.log("Zoho SMTP server is ready to send emails");
  }
});

// Reusable send function
async function sendEmail(mailOptions) {
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.messageId);
    return true;
  } catch (error) {
    console.error("Failed to send email:", error.message);
    if (error.response) {
      console.error("SMTP Response:", error.response);
    }
    return false;
  }
}

// Helper: Professional "From" address
const getFromAddress = () => {
  const name = process.env.EMAIL_FROM_NAME || "PipiAfrica";
  return `"${name}" <${process.env.EMAIL_USERNAME}>`;
};

// === EMAIL FUNCTIONS ===

// 1. Email Verification
async function sendVerificationEmail(
  email,
  verificationCode,
  verificationUrl = null,
) {
  if (!email || !verificationCode) return false;

  const mailOptions = {
    from: getFromAddress(),
    to: email,
    subject: "Verify Your Email Address",
    html: `
      <div style="margin:0; padding:0; background-color:#f6f9fc; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
          <tr>
            <td align="center">
              
              <!-- Card -->
              <table width="100%" cellpadding="0" cellspacing="0" 
                style="max-width:600px; background:#ffffff; border-radius:16px; padding:40px; box-shadow:0 10px 30px rgba(0,0,0,0.05);">
                
                <!-- Logo / Brand -->
                <tr>
                  <td align="center" style="padding-bottom:20px;">
                    <h1 style="margin:0; font-size:24px; color:#111; letter-spacing:0.5px;">
                      PipiAfrica
                    </h1>
                  </td>
                </tr>

                <!-- Heading -->
                <tr>
                  <td align="center" style="padding-bottom:10px;">
                    <h2 style="margin:0; font-size:20px; color:#222;">
                      Verify Your Email Address
                    </h2>
                  </td>
                </tr>

                <!-- Subtitle -->
                <tr>
                  <td align="center" style="padding-bottom:30px;">
                    <p style="margin:0; color:#555; font-size:14px; line-height:1.6;">
                      Thanks for joining us! Please use the verification code below 
                      to complete your registration.
                    </p>
                  </td>
                </tr>

                <!-- Verification Code Box -->
                <tr>
                  <td align="center" style="padding-bottom:30px;">
                    <div style="
                      display:inline-block;
                      padding:20px 30px;
                      font-size:28px;
                      font-weight:700;
                      letter-spacing:8px;
                      background:linear-gradient(135deg,#f8f9fa,#eef1f5);
                      border-radius:12px;
                      color:#111;
                      border:1px solid #e6e8ec;
                    ">
                      ${verificationCode}
                    </div>
                  </td>
                </tr>

                ${
                  verificationUrl
                    ? `
                <!-- Button -->
                <tr>
                  <td align="center" style="padding-bottom:25px;">
                    <a href="${verificationUrl}" 
                      style="
                        display:inline-block;
                        padding:14px 32px;
                        background:linear-gradient(135deg,#e63946,#d62839);
                        color:#ffffff;
                        text-decoration:none;
                        font-size:14px;
                        font-weight:600;
                        border-radius:10px;
                        box-shadow:0 8px 20px rgba(230,57,70,0.25);
                      ">
                      Verify Email
                    </a>
                  </td>
                </tr>
                `
                    : ""
                }

                <!-- Expiry Text -->
                <tr>
                  <td align="center" style="padding-bottom:20px;">
                    <p style="margin:0; font-size:13px; color:#777;">
                      ⏳ This code expires in <strong>10 minutes</strong>.
                    </p>
                  </td>
                </tr>

                <!-- Divider -->
                <tr>
                  <td>
                    <hr style="border:none; border-top:1px solid #eee; margin:30px 0;">
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td align="center">
                    <p style="margin:0; font-size:12px; color:#999; line-height:1.6;">
                      If you didn’t request this email, you can safely ignore it.<br/>
                      © ${new Date().getFullYear()} PipiAfrica. All rights reserved.
                    </p>
                  </td>
                </tr>

              </table>
              <!-- End Card -->

            </td>
          </tr>
        </table>
      </div>
    `,
  };

  return await sendEmail(mailOptions);
}

// 2. Password Reset
async function sendPasswordResetEmail(email, resetLink, resetKey) {
  if (!email || !resetLink || !resetKey) return false;

  const mailOptions = {
    from: getFromAddress(),
    to: email,
    subject: "Reset Your Password",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #333;">Password Reset Request</h2>
        <p>We received a request to reset your password.</p>
        <p style="font-size: 18px;"><strong>Your reset code:</strong> <code style="background:#f4f4f4;padding:5px 10px;border-radius:4px;">${resetKey}</code></p>
        <p>Or click the button below to reset securely:</p>
        <a href="${resetLink}" style="display: inline-block; background: #e63946; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 15px 0;">Reset Password</a>
        <p style="color: #d32f2f;">This link expires in <strong>15 minutes</strong>.</p>
        <hr style="margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">If you didn't request this, your account is safe — just ignore this email.</p>
      </div>
    `,
  };

  return await sendEmail(mailOptions);
}

// 3. Data Download Request (Admin + User Auto-Reply)
async function sendDataRequestEmails(
  userEmail,
  userName,
  userId,
  requestedItems,
) {
  if (!userEmail || !userName || !requestedItems?.length) return false;

  const itemsList = requestedItems.join(", ");
  const fromAddress = getFromAddress();

  // Email to Admin (you)
  const adminEmail = {
    from: fromAddress,
    to: process.env.EMAIL_USERNAME, // or a dedicated admin email
    subject: `New Data Download Request – ${userName}`,
    html: `
      <div style="font-family: Arial, sans-serif;">
        <h2>New User Data Request</h2>
        <p><strong>User:</strong> ${userName}</p>
        <p><strong>Email:</strong> ${userEmail}</p>
        <p><strong>User ID:</strong> ${userId}</p>
        <p><strong>Requested Items:</strong> ${itemsList}</p>
        <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
        <hr>
        <p><em>Please prepare and securely send their data within 48 hours.</em></p>
      </div>
    `,
  };

  // Auto-reply to User
  const userEmailOptions = {
    from: fromAddress,
    to: userEmail,
    subject: "We've Received Your Data Request",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2>Hi ${userName},</h2>
        <p>Thank you for reaching out!</p>
        <p>We’ve received your request to download your personal information.</p>
        <p><strong>Requested items:</strong> ${itemsList}</p>
        <p>Your data is being prepared and will be sent to you securely within <strong>48 hours</strong>.</p>
        <br>
        <p>Best regards,<br><strong>The PipiAfrica Team</strong></p>
      </div>
    `,
  };

  const adminSent = await sendEmail(adminEmail);
  const userSent = await sendEmail(userEmailOptions);

  return adminSent && userSent;
}

// 4. New Login / Session Detected Alert

async function sendNewSessionEmail(userEmail, userAgentInfo, ipAddress) {
  if (!userEmail || !userAgentInfo || !ipAddress) {
    console.error("Missing required parameters for new session email");
    return false;
  }

  const fromAddress = getFromAddress();

  // Node.js-safe HTML escaping function
  function escapeHtml(text) {
    if (!text) return "";
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.toString().replaceAll(/[&<>"']/g, (m) => map[m]);
  }

  const mailOptions = {
    from: fromAddress,
    to: userEmail,
    subject: "🚨 New Login to Your PipiAfrica Account",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 12px; background: #f9f9f9;">
        <h2 style="color: #d32f2f; text-align: center;">New Login Detected</h2>
        <p>Hi there,</p>
        <p>We noticed a new login to your PipiAfrica account from a device or location that hasn't been used before.</p>

        <div style="background: white; padding: 15px; border-radius: 8px; border-left: 4px solid #e63946; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #333;">Login Details:</h3>
          <ul style="line-height: 1.8;">
            <li><strong>Device:</strong> ${escapeHtml(userAgentInfo.deviceName || "Unknown")}</li>
            <li><strong>Browser:</strong> ${escapeHtml(userAgentInfo.browser || "Unknown")}</li>
            <li><strong>Operating System:</strong> ${escapeHtml(userAgentInfo.os || "Unknown")}</li>
            <li><strong>IP Address:</strong> <code>${escapeHtml(ipAddress)}</code></li>
            <li><strong>Time:</strong> ${new Date().toLocaleString()}</li>
          </ul>
        </div>

        <p><strong>If this was you</strong>, you can safely ignore this email.</p>
        <p><strong>If you don't recognize this login</strong>, please take action immediately:</p>
        <ul>
          <li>Change your password</li>
          <li>Enable two-factor authentication (if not already)</li>
          <li>Review recent account activity</li>
        </ul>

        <div style="text-align: center; margin: 25px 0;">
          <a href="https://pipiafrica.com/reset-password" 
             style="background: #e63946; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
            Reset Password Now
          </a>
        </div>

        <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
        <p style="color: #777; font-size: 12px; text-align: center;">
          This is an automated security alert from PipiAfrica.<br>
          For your safety, we monitor logins and notify you of suspicious activity.
        </p>
      </div>
    `,
  };

  return await sendEmail(mailOptions);
}

// Export all functions
module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendDataRequestEmails,
  sendNewSessionEmail,
};
