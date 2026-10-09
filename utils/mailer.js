import nodemailer from "nodemailer";

// Temporary Email Override for Testing / Development
// All outbound emails (OTP, FD approvals, Security Alerts) are redirected to this address for testing.
// To send emails to real customer email addresses later, set TEMP_TARGET_EMAIL = null (or set process.env.TEMP_OVERRIDE_EMAIL).
const TEMP_TARGET_EMAIL = null;

/**
 * Creates and returns a Nodemailer transporter instance using environment variables.
 */
const getTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (
    !host ||
    !user ||
    !pass ||
    user.includes("your_email") ||
    pass.includes("your_app_password")
  ) {
    return null; // Return null if SMTP credentials are missing or placeholder values
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  });
};

/**
 * Send OTP Email via SMTP with console fallback for local dev.
 * @param {string} email - Recipient email address
 * @param {string} otp - 6-digit OTP code
 * @param {string} purpose - Purpose of OTP ("registration", "reset_mpin", etc.)
 */
export const sendOTPEmail = async (email, otp, purpose = "registration") => {
  const transporter = getTransporter();
  const fromEmail = process.env.SMTP_FROM || `"Flowly Finance" <no-reply@flowlyfinance.com>`;
  const targetEmail = TEMP_TARGET_EMAIL || email;

  const purposeTitleMap = {
    registration: "Account Registration OTP",
    generate_mpin: "Generate MPIN Verification Code",
    reset_mpin: "Reset MPIN Verification Code",
    login: "Login Verification Code",
  };

  const title = purposeTitleMap[purpose] || "Verification Code";

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px; background-color: #ffffff;">
      <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #f0f0f0;">
        <h2 style="color: #5B2E91; margin: 0;">Flowly Finance</h2>
      </div>
      <div style="padding: 20px 0;">
        <h3 style="color: #333333; margin-top: 0;">${title}</h3>
        <p style="color: #666666; line-height: 1.5;">Use the verification code below to complete your process. This code is valid for <strong>5 minutes</strong>.</p>
        <div style="text-align: center; margin: 30px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #5B2E91; background-color: #F3EEF9; padding: 12px 24px; border-radius: 8px; display: inline-block;">${otp}</span>
        </div>
        <p style="color: #999999; font-size: 12px; line-height: 1.4;">Intended Account: ${email}</p>
        <p style="color: #999999; font-size: 12px; line-height: 1.4;">If you did not request this verification code, please ignore this email.</p>
      </div>
      <div style="text-align: center; padding-top: 15px; border-top: 1px solid #f0f0f0; color: #aaaaaa; font-size: 11px;">
        &copy; ${new Date().getFullYear()} Flowly Finance. All rights reserved.
      </div>
    </div>
  `;

  if (!transporter) {
    console.log(`\n=================================================`);
    console.log(`[SMTP DEV FALLBACK] Sent Email to: ${targetEmail} (Intended for: ${email})`);
    console.log(`[SMTP DEV FALLBACK] Purpose: ${purpose}`);
    console.log(`[SMTP DEV FALLBACK] OTP Code: ${otp}`);
    console.log(`=================================================\n`);
    return { success: true, fallback: true };
  }

  try {
    const info = await transporter.sendMail({
      from: fromEmail,
      to: targetEmail,
      subject: `${otp} is your Flowly Finance verification code`,
      html: htmlContent,
    });

    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.warn(`[SMTP SEND FAILED] ${err.message}. Falling back to console output.`);
    console.log(`\n=================================================`);
    console.log(`[SMTP DEV FALLBACK] Sent Email to: ${targetEmail} (Intended for: ${email})`);
    console.log(`[SMTP DEV FALLBACK] Purpose: ${purpose}`);
    console.log(`[SMTP DEV FALLBACK] OTP Code: ${otp}`);
    console.log(`=================================================\n`);
    return { success: true, fallback: true, error: err.message };
  }
};

/**
 * Send Fixed Deposit approval/activation email, with the generated FD
 * certificate PDF attached (if provided) and linked as a fallback.
 * "FD Certificate Generated" -> "SMS / Email / Notification" step of the FD flow.
 *
 * @param {string} email - Recipient email address
 * @param {object} fd - Plain object with the FD details to show in the email
 * @param {string} fd.userName
 * @param {string} fd.fdNumber
 * @param {number} fd.principalAmount
 * @param {number} fd.interestRate
 * @param {number} fd.tenureMonths
 * @param {string|Date} fd.maturityDate
 * @param {number} fd.maturityAmount
 * @param {string} [fd.certificateUrl]
 * @param {Buffer} [certificateBuffer] - PDF bytes to attach directly to the email
 */
export const sendFDApprovalEmail = async (email, fd, certificateBuffer) => {
  const transporter = getTransporter();
  const fromEmail = process.env.SMTP_FROM || `"Flowly Finance" <no-reply@flowlyfinance.com>`;
  const targetEmail = TEMP_TARGET_EMAIL || email;

  const formatINR = (n) =>
    `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatDate = (d) =>
    new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px; background-color: #ffffff;">
      <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #f0f0f0;">
        <h2 style="color: #5B2E91; margin: 0;">Flowly Finance</h2>
      </div>
      <div style="padding: 20px 0;">
        <h3 style="color: #1E8E5A; margin-top: 0;">✅ Your Fixed Deposit is now Active</h3>
        <p style="color: #333333; line-height: 1.5;">Dear <strong>${fd.userName || "Customer"}</strong>,</p>
        <p style="color: #555555; line-height: 1.6;">
          Congratulations! Your Fixed Deposit has been approved and activated. Your FD certificate is attached to this email for your records.
        </p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 13px;">
          <tr><td style="padding: 6px 0; color: #888888;">FD Number</td><td style="padding: 6px 0; color: #111111; font-weight: bold; text-align: right;">${fd.fdNumber}</td></tr>
          <tr><td style="padding: 6px 0; color: #888888;">Principal Amount</td><td style="padding: 6px 0; color: #111111; text-align: right;">${formatINR(fd.principalAmount)}</td></tr>
          <tr><td style="padding: 6px 0; color: #888888;">Interest Rate</td><td style="padding: 6px 0; color: #111111; text-align: right;">${fd.interestRate}% p.a.</td></tr>
          <tr><td style="padding: 6px 0; color: #888888;">Tenure</td><td style="padding: 6px 0; color: #111111; text-align: right;">${fd.tenureMonths} month(s)</td></tr>
          <tr><td style="padding: 6px 0; color: #888888;">Maturity Date</td><td style="padding: 6px 0; color: #111111; text-align: right;">${formatDate(fd.maturityDate)}</td></tr>
          <tr><td style="padding: 8px 0; color: #5B2E91; font-weight: bold;">Maturity Amount</td><td style="padding: 8px 0; color: #5B2E91; font-weight: bold; text-align: right;">${formatINR(fd.maturityAmount)}</td></tr>
        </table>
        ${
          fd.certificateUrl
            ? `<div style="text-align: center; margin: 20px 0;">
                 <a href="${fd.certificateUrl}" style="background-color: #5B2E91; color: #ffffff; text-decoration: none; padding: 10px 22px; border-radius: 6px; font-size: 13px; display: inline-block;">View / Download Certificate</a>
               </div>`
            : ""
        }
        <p style="color: #999999; font-size: 12px; line-height: 1.4;">You can also view this Fixed Deposit anytime in the Flowly Finance app.</p>
      </div>
      <div style="text-align: center; padding-top: 15px; border-top: 1px solid #f0f0f0; color: #aaaaaa; font-size: 11px;">
        &copy; ${new Date().getFullYear()} Flowly Finance. All rights reserved.
      </div>
    </div>
  `;

  const attachments = certificateBuffer
    ? [
        {
          filename: `${fd.fdNumber}-certificate.pdf`,
          content: certificateBuffer,
          contentType: "application/pdf",
        },
      ]
    : [];

  if (!transporter) {
    console.log(`\n=================================================`);
    console.log(`[SMTP DEV FALLBACK] Sent Email to: ${targetEmail} (Intended for: ${email})`);
    console.log(`[SMTP DEV FALLBACK] Purpose: FD Approved - ${fd.fdNumber}`);
    console.log(`[SMTP DEV FALLBACK] Certificate attached: ${attachments.length > 0}`);
    console.log(`=================================================\n`);
    return { success: true, fallback: true };
  }

  try {
    const info = await transporter.sendMail({
      from: fromEmail,
      to: targetEmail,
      subject: `Your Fixed Deposit ${fd.fdNumber} is Active - Flowly Finance`,
      html: htmlContent,
      attachments,
    });

    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.warn(`[SMTP FD EMAIL FAILED] ${err.message}. Falling back to console output.`);
    console.log(`\n=================================================`);
    console.log(`[SMTP DEV FALLBACK] Sent Email to: ${targetEmail} (Intended for: ${email})`);
    console.log(`[SMTP DEV FALLBACK] Purpose: FD Approved - ${fd.fdNumber}`);
    console.log(`=================================================\n`);
    return { success: true, fallback: true, error: err.message };
  }
};

/**
 * Send the "money added" receipt after a successful card top-up.
 * @param {string} email - Recipient email address
 * @param {object} receipt - Receipt built by walletService.buildReceipt
 * @param {string} userName - Customer's name
 */
export const sendTopUpReceiptEmail = async (email, receipt, userName = "Customer") => {
  const transporter = getTransporter();
  const fromEmail = process.env.SMTP_FROM || `"Flowly Finance" <no-reply@flowlyfinance.com>`;
  const targetEmail = TEMP_TARGET_EMAIL || email;

  const formatINR = (n) =>
    `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const when = new Date(receipt.completedAt || Date.now()).toLocaleString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const card = receipt.paymentMethod?.last4
    ? `${(receipt.paymentMethod.brand || "Card").toUpperCase()} •••• ${receipt.paymentMethod.last4}`
    : "Card";

  const row = (label, value, bold = false) =>
    `<tr><td style="padding: 6px 0; color: #888888;">${label}</td><td style="padding: 6px 0; color: #111111; text-align: right;${bold ? " font-weight: bold;" : ""}">${value}</td></tr>`;

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px; background-color: #ffffff;">
      <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #f0f0f0;">
        <h2 style="color: #5B2E91; margin: 0;">Flowly Finance</h2>
      </div>
      <div style="padding: 20px 0;">
        <h3 style="color: #1E8E5A; margin-top: 0;">✅ Money added to your account</h3>
        <p style="color: #333333; line-height: 1.5;">Dear <strong>${userName}</strong>,</p>
        <p style="color: #555555; line-height: 1.6;">${formatINR(receipt.amount)} has been added to your ${receipt.account?.accountType || "bank"} account.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 13px;">
          ${row("Reference No.", receipt.receiptNumber, true)}
          ${row("Account", `${receipt.account?.accountNumber || ""} (${receipt.account?.accountType || ""})`)}
          ${row("Paid with", card)}
          ${row("Date &amp; time", when)}
          ${row("Amount added", formatINR(receipt.amount), true)}
          ${row("New balance", formatINR(receipt.balanceAfter), true)}
        </table>
        <p style="color: #999999; font-size: 12px; line-height: 1.4;">You can view this transaction anytime in the Flowly Finance app. If you did not make this payment, contact support immediately.</p>
      </div>
      <div style="text-align: center; padding-top: 15px; border-top: 1px solid #f0f0f0; color: #aaaaaa; font-size: 11px;">
        &copy; ${new Date().getFullYear()} Flowly Finance. All rights reserved.
      </div>
    </div>
  `;

  if (!transporter) {
    console.log(`\n[SMTP DEV FALLBACK] Top-up receipt to: ${targetEmail} (Intended for: ${email}) - ${receipt.receiptNumber} - ${formatINR(receipt.amount)}\n`);
    return { success: true, fallback: true };
  }

  try {
    const info = await transporter.sendMail({
      from: fromEmail,
      to: targetEmail,
      subject: `Money added - ${formatINR(receipt.amount)} (Ref ${receipt.receiptNumber}) - Flowly Finance`,
      html: htmlContent,
    });
    return { success: true, messageId: info.messageId };
  } catch (e) {
    console.warn(`[SMTP TOP-UP EMAIL FAILED] ${e.message}`);
    return { success: true, fallback: true, error: e.message };
  }
};

/**
 * Send receipt for an offline cash deposit made at a branch.
 */
export const sendCashDepositReceiptEmail = async (email, receipt, userName = "Customer") => {
  const transporter = getTransporter();
  const fromEmail = process.env.SMTP_FROM || `"Flowly Finance" <no-reply@flowlyfinance.com>`;
  const targetEmail = TEMP_TARGET_EMAIL || email;

  const formatINR = (n) =>
    `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const when = new Date(receipt.completedAt || Date.now()).toLocaleString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const row = (label, value, bold = false) =>
    `<tr><td style="padding: 6px 0; color: #888888;">${label}</td><td style="padding: 6px 0; color: #111111; text-align: right;${bold ? " font-weight: bold;" : ""}">${value}</td></tr>`;

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px; background-color: #ffffff;">
      <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #f0f0f0;">
        <h2 style="color: #5B2E91; margin: 0;">Flowly Finance</h2>
      </div>
      <div style="padding: 20px 0;">
        <h3 style="color: #1E8E5A; margin-top: 0;">✅ Cash deposit received</h3>
        <p style="color: #333333; line-height: 1.5;">Dear <strong>${userName}</strong>,</p>
        <p style="color: #555555; line-height: 1.6;">${formatINR(receipt.amount)} was deposited in cash to your savings account at our branch.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 13px;">
          ${row("Reference No.", receipt.receiptNumber, true)}
          ${row("Account", `${receipt.account?.accountNumber || ""} (${receipt.account?.accountType || ""})`)}
          ${row("Branch", receipt.branch || "-")}
          ${row("Date &amp; time", when)}
          ${row("Amount deposited", formatINR(receipt.amount), true)}
          ${row("New balance", formatINR(receipt.updatedBalance), true)}
        </table>
        <p style="color: #999999; font-size: 12px; line-height: 1.4;">You can view this transaction anytime in the Flowly Finance app. If you did not make this deposit, contact support immediately.</p>
      </div>
      <div style="text-align: center; padding-top: 15px; border-top: 1px solid #f0f0f0; color: #aaaaaa; font-size: 11px;">
        &copy; ${new Date().getFullYear()} Flowly Finance. All rights reserved.
      </div>
    </div>
  `;

  if (!transporter) {
    console.log(`\n[SMTP DEV FALLBACK] Cash deposit receipt to: ${targetEmail} (Intended for: ${email}) - ${receipt.receiptNumber} - ${formatINR(receipt.amount)}\n`);
    return { success: true, fallback: true };
  }

  try {
    const info = await transporter.sendMail({
      from: fromEmail,
      to: targetEmail,
      subject: `Cash deposit - ${formatINR(receipt.amount)} (Ref ${receipt.receiptNumber}) - Flowly Finance`,
      html: htmlContent,
    });
    return { success: true, messageId: info.messageId };
  } catch (e) {
    console.warn(`[SMTP CASH DEPOSIT EMAIL FAILED] ${e.message}`);
    return { success: true, fallback: true, error: e.message };
  }
};

/**
 * Send Security Alert Email on 4 Failed Login Attempts (Account Suspension)
 * @param {string} email - Recipient email address
 * @param {string} userName - Account user's full name
 */
export const sendAccountLockoutEmail = async (email, userName = "Customer") => {
  const transporter = getTransporter();
  const fromEmail = process.env.SMTP_FROM || `"Flowly Finance" <no-reply@flowlyfinance.com>`;
  const targetEmail = TEMP_TARGET_EMAIL || email;

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px; background-color: #ffffff;">
      <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #f0f0f0;">
        <h2 style="color: #5B2E91; margin: 0;">Flowly Finance</h2>
      </div>
      <div style="padding: 20px 0;">
        <h3 style="color: #B23A2E; margin-top: 0;">⚠️ Security Alert: Account Suspended</h3>
        <p style="color: #333333; line-height: 1.5;">Dear <strong>${userName}</strong>,</p>
        <p style="color: #555555; line-height: 1.6;">
          Your Flowly Finance account (${email}) has been <strong>temporarily suspended for 24 hours</strong> due to <strong>4 consecutive incorrect login/MPIN attempts</strong>.
        </p>
        <div style="background-color: #FAF5FF; padding: 16px; border-radius: 8px; border-left: 4px solid #5B2E91; margin: 20px 0;">
          <p style="margin: 0; color: #5B2E91; font-weight: bold; font-size: 14px;">Next Steps:</p>
          <ul style="margin: 8px 0 0 0; padding-left: 20px; color: #555555; font-size: 13px;">
            <li>If this was you, you can reset your MPIN using the <strong>Forgot MPIN</strong> option on the login page via OTP.</li>
            <li>Alternatively, your account access will automatically restore in 24 hours.</li>
            <li>If you did not perform these login attempts, please contact support immediately.</li>
          </ul>
        </div>
      </div>
      <div style="text-align: center; padding-top: 15px; border-top: 1px solid #f0f0f0; color: #aaaaaa; font-size: 11px;">
        &copy; ${new Date().getFullYear()} Flowly Finance. All rights reserved.
      </div>
    </div>
  `;

  if (!transporter) {
    console.log(`\n=================================================`);
    console.log(`[SMTP DEV FALLBACK] SECURITY ALERT: ACCOUNT LOCKOUT`);
    console.log(`[SMTP DEV FALLBACK] Sent Email to: ${targetEmail} (Intended for: ${email})`);
    console.log(`[SMTP DEV FALLBACK] User: ${userName}`);
    console.log(`[SMTP DEV FALLBACK] Status: Suspended for 24 hours (4 failed attempts)`);
    console.log(`=================================================\n`);
    return { success: true, fallback: true };
  }

  try {
    const info = await transporter.sendMail({
      from: fromEmail,
      to: targetEmail,
      subject: `Security Alert: Account Temporarily Suspended - Flowly Finance`,
      html: htmlContent,
    });

    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.warn(`[SMTP LOCKOUT EMAIL FAILED] ${err.message}. Falling back to console output.`);
    console.log(`\n=================================================`);
    console.log(`[SMTP DEV FALLBACK] SECURITY ALERT: ACCOUNT LOCKOUT`);
    console.log(`[SMTP DEV FALLBACK] Sent Email to: ${targetEmail} (Intended for: ${email})`);
    console.log(`[SMTP DEV FALLBACK] User: ${userName}`);
    console.log(`=================================================\n`);
    return { success: true, fallback: true, error: err.message };
  }
};

/**
 * Send Video KYC Schedule Confirmation / Assignment Email.
 * Triggered when a worker or admin schedules or reschedules a Video KYC call for a customer.
 */
export const sendVideoKycScheduleEmail = async (email, details = {}) => {
  const transporter = getTransporter();
  const fromEmail = process.env.SMTP_FROM || `"Flowly Finance" <no-reply@flowlyfinance.com>`;
  const targetEmail = TEMP_TARGET_EMAIL || email;

  const {
    userName = "Customer",
    scheduledAt,
    durationMinutes = 30,
    officerName = "Verification Officer",
    notes = "",
    isRescheduled = false,
  } = details;

  const formattedTime = new Date(scheduledAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "full",
    timeStyle: "short",
  });

  const titleText = isRescheduled
    ? "📅 KYC Video Call Schedule Updated"
    : "📹 KYC Video Call Scheduled";

  const actionNotice = isRescheduled
    ? `Your video KYC verification call schedule has been updated by <strong>${officerName}</strong>.`
    : `Your video KYC verification call schedule has been assigned by <strong>${officerName}</strong>.`;

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px; background-color: #ffffff;">
      <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #f0f0f0;">
        <h2 style="color: #5B2E91; margin: 0;">Flowly Finance</h2>
      </div>
      <div style="padding: 20px 0;">
        <h3 style="color: #5B2E91; margin-top: 0;">${titleText}</h3>
        <p style="color: #333333; line-height: 1.5;">Dear <strong>${userName}</strong>,</p>
        <p style="color: #555555; line-height: 1.6;">${actionNotice}</p>
        
        <div style="background-color: #F8F5FC; border-left: 4px solid #5B2E91; padding: 16px; border-radius: 6px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 6px 0; color: #666666;">Date &amp; Time (IST):</td>
              <td style="padding: 6px 0; color: #111111; font-weight: bold; text-align: right;">${formattedTime}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #666666;">Duration:</td>
              <td style="padding: 6px 0; color: #111111; text-align: right;">${durationMinutes} mins</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #666666;">Assigned Officer:</td>
              <td style="padding: 6px 0; color: #111111; text-align: right;">${officerName}</td>
            </tr>
            ${
              notes
                ? `<tr><td style="padding: 6px 0; color: #666666;">Officer Notes:</td><td style="padding: 6px 0; color: #111111; text-align: right;">${notes}</td></tr>`
                : ""
            }
          </table>
        </div>

        <div style="margin: 20px 0;">
          <p style="color: #333333; font-weight: bold; margin-bottom: 8px;">📋 Checklist for your call:</p>
          <ul style="color: #555555; line-height: 1.6; margin: 0; padding-left: 20px; font-size: 13px;">
            <li>Keep your original <strong>PAN Card</strong> and <strong>Aadhaar Card</strong> physically available.</li>
            <li>Ensure you are in a <strong>well-lit and quiet room</strong>.</li>
            <li>Connect to a <strong>stable internet connection</strong>.</li>
            <li>Allow camera and microphone access when joining from the Flowly app.</li>
          </ul>
        </div>

        <div style="background-color: #FFF9E6; border: 1px solid #FFE082; padding: 12px; border-radius: 6px; font-size: 12px; color: #8D6E00;">
          🔔 <strong>Reminder setup active:</strong> You will receive an automated email reminder 15 minutes prior to your call.
        </div>
      </div>
      <div style="text-align: center; padding-top: 15px; border-top: 1px solid #f0f0f0; color: #aaaaaa; font-size: 11px;">
        &copy; ${new Date().getFullYear()} Flowly Finance. All rights reserved.
      </div>
    </div>
  `;

  if (!transporter) {
    console.log(`\n=================================================`);
    console.log(`[SMTP DEV FALLBACK] VIDEO KYC SCHEDULED EMAIL`);
    console.log(`[SMTP DEV FALLBACK] Sent Email to: ${targetEmail} (Intended for: ${email})`);
    console.log(`[SMTP DEV FALLBACK] User: ${userName}`);
    console.log(`[SMTP DEV FALLBACK] Scheduled At: ${formattedTime}`);
    console.log(`[SMTP DEV FALLBACK] Officer: ${officerName}`);
    console.log(`=================================================\n`);
    return { success: true, fallback: true };
  }

  try {
    const subject = isRescheduled
      ? `[Updated] Your Video KYC Call Schedule - Flowly Finance`
      : `Your Video KYC Call is Scheduled for ${formattedTime} - Flowly Finance`;

    const info = await transporter.sendMail({
      from: fromEmail,
      to: targetEmail,
      subject,
      html: htmlContent,
    });

    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.warn(`[SMTP VIDEO KYC SCHEDULE EMAIL FAILED] ${err.message}. Falling back to console.`);
    console.log(`\n=================================================`);
    console.log(`[SMTP DEV FALLBACK] VIDEO KYC SCHEDULED EMAIL`);
    console.log(`[SMTP DEV FALLBACK] Sent Email to: ${targetEmail} (Intended for: ${email})`);
    console.log(`[SMTP DEV FALLBACK] Scheduled At: ${formattedTime}`);
    console.log(`=================================================\n`);
    return { success: true, fallback: true, error: err.message };
  }
};

/**
 * Send Video KYC Upcoming Call Reminder Email.
 * Automatically sent 15 minutes before the scheduled video call time.
 */
export const sendVideoKycReminderEmail = async (email, details = {}) => {
  const transporter = getTransporter();
  const fromEmail = process.env.SMTP_FROM || `"Flowly Finance" <no-reply@flowlyfinance.com>`;
  const targetEmail = TEMP_TARGET_EMAIL || email;

  const {
    userName = "Customer",
    scheduledAt,
    durationMinutes = 30,
    officerName = "Verification Officer",
  } = details;

  const formattedTime = new Date(scheduledAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px; background-color: #ffffff;">
      <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #f0f0f0;">
        <h2 style="color: #5B2E91; margin: 0;">Flowly Finance</h2>
      </div>
      <div style="padding: 20px 0;">
        <h3 style="color: #D97706; margin-top: 0;">⏰ Reminder: Video KYC Call Starts Soon!</h3>
        <p style="color: #333333; line-height: 1.5;">Dear <strong>${userName}</strong>,</p>
        <p style="color: #555555; line-height: 1.6;">
          This is a quick reminder that your Video KYC verification call with <strong>${officerName}</strong> starts in <strong>less than 15 minutes</strong> at <strong>${formattedTime} (IST)</strong>.
        </p>
        
        <div style="background-color: #FEF3C7; border-left: 4px solid #D97706; padding: 14px; border-radius: 6px; margin: 20px 0;">
          <p style="margin: 0; color: #92400E; font-weight: bold; font-size: 14px;">⚡ Please Get Ready:</p>
          <ul style="margin: 8px 0 0 0; padding-left: 20px; color: #78350F; font-size: 13px;">
            <li>Keep your physical PAN Card &amp; Aadhaar Card with you.</li>
            <li>Open the Flowly Finance app and navigate to the <strong>Video KYC</strong> section.</li>
            <li>Click <strong>Join Call</strong> as soon as the join window opens.</li>
          </ul>
        </div>

        <p style="color: #999999; font-size: 12px; line-height: 1.4;">
          If you are unable to join at this time, please contact support or request a reschedule via the app.
        </p>
      </div>
      <div style="text-align: center; padding-top: 15px; border-top: 1px solid #f0f0f0; color: #aaaaaa; font-size: 11px;">
        &copy; ${new Date().getFullYear()} Flowly Finance. All rights reserved.
      </div>
    </div>
  `;

  if (!transporter) {
    console.log(`\n=================================================`);
    console.log(`[SMTP DEV FALLBACK] VIDEO KYC REMINDER EMAIL`);
    console.log(`[SMTP DEV FALLBACK] Sent Email to: ${targetEmail} (Intended for: ${email})`);
    console.log(`[SMTP DEV FALLBACK] User: ${userName}`);
    console.log(`[SMTP DEV FALLBACK] Scheduled At: ${formattedTime}`);
    console.log(`=================================================\n`);
    return { success: true, fallback: true };
  }

  try {
    const info = await transporter.sendMail({
      from: fromEmail,
      to: targetEmail,
      subject: `⏰ Reminder: Your Video KYC call starts in 15 minutes! - Flowly Finance`,
      html: htmlContent,
    });

    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.warn(`[SMTP VIDEO KYC REMINDER EMAIL FAILED] ${err.message}. Falling back to console.`);
    console.log(`\n=================================================`);
    console.log(`[SMTP DEV FALLBACK] VIDEO KYC REMINDER EMAIL`);
    console.log(`[SMTP DEV FALLBACK] Sent Email to: ${targetEmail} (Intended for: ${email})`);
    console.log(`[SMTP DEV FALLBACK] Scheduled At: ${formattedTime}`);
    console.log(`=================================================\n`);
    return { success: true, fallback: true, error: err.message };
  }
};

/**
 * Send Video KYC Cancellation Email.
 */
export const sendVideoKycCancelledEmail = async (email, details = {}) => {
  const transporter = getTransporter();
  const fromEmail = process.env.SMTP_FROM || `"Flowly Finance" <no-reply@flowlyfinance.com>`;
  const targetEmail = TEMP_TARGET_EMAIL || email;

  const { userName = "Customer", reason = "" } = details;

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px; background-color: #ffffff;">
      <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #f0f0f0;">
        <h2 style="color: #5B2E91; margin: 0;">Flowly Finance</h2>
      </div>
      <div style="padding: 20px 0;">
        <h3 style="color: #DC2626; margin-top: 0;">❌ Video KYC Call Cancelled</h3>
        <p style="color: #333333; line-height: 1.5;">Dear <strong>${userName}</strong>,</p>
        <p style="color: #555555; line-height: 1.6;">
          Your scheduled Video KYC call has been cancelled.
          ${reason ? `<br/><strong>Reason:</strong> ${reason}` : ""}
        </p>
        <p style="color: #555555; line-height: 1.6;">
          Our verification team will assign a new time slot for your video call shortly.
        </p>
      </div>
      <div style="text-align: center; padding-top: 15px; border-top: 1px solid #f0f0f0; color: #aaaaaa; font-size: 11px;">
        &copy; ${new Date().getFullYear()} Flowly Finance. All rights reserved.
      </div>
    </div>
  `;

  if (!transporter) {
    console.log(`\n[SMTP DEV FALLBACK] VIDEO KYC CANCELLED EMAIL to: ${targetEmail} (User: ${userName})\n`);
    return { success: true, fallback: true };
  }

  try {
    const info = await transporter.sendMail({
      from: fromEmail,
      to: targetEmail,
      subject: `Notice: Video KYC Call Cancelled - Flowly Finance`,
      html: htmlContent,
    });
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.warn(`[SMTP CANCEL EMAIL FAILED] ${err.message}`);
    return { success: true, fallback: true, error: err.message };
  }
};

/**
 * Send Cash Withdrawal receipt email with PDF receipt attachment.
 * @param {string} email
 * @param {object} receipt
 * @param {Buffer} [pdfBuffer]
 */
export const sendWithdrawalReceiptEmail = async (email, receipt, pdfBuffer) => {
  if (!email) return { success: false, message: "No email address provided" };
  const transporter = getTransporter();
  const fromEmail = process.env.SMTP_FROM || `"Flowly Finance" <no-reply@flowlyfinance.com>`;
  const targetEmail = TEMP_TARGET_EMAIL || email;

  const formatINR = (n) =>
    `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px; background-color: #ffffff;">
      <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #f0f0f0;">
        <h2 style="color: #5B2E91; margin: 0;">Flowly Finance</h2>
      </div>
      <div style="padding: 20px 0;">
        <h3 style="color: #B23A2E; margin-top: 0;">💸 Cash Withdrawal Receipt</h3>
        <p style="color: #333333; line-height: 1.5;">Dear <strong>${receipt.customerName || "Customer"}</strong>,</p>
        <p style="color: #555555; line-height: 1.6;">
          Your cash withdrawal request of <strong>${formatINR(receipt.amount)}</strong> has been processed at the branch counter. Attached is your official PDF receipt for your financial records.
        </p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 13px;">
          <tr><td style="padding: 6px 0; color: #888888;">Receipt Number</td><td style="padding: 6px 0; color: #5B2E91; font-weight: bold; text-align: right;">${receipt.receiptNumber}</td></tr>
          <tr><td style="padding: 6px 0; color: #888888;">Amount Disbursed</td><td style="padding: 6px 0; color: #B23A2E; font-weight: bold; text-align: right;">-${formatINR(receipt.amount)}</td></tr>
          <tr><td style="padding: 6px 0; color: #888888;">Account Number</td><td style="padding: 6px 0; color: #111111; text-align: right;">${receipt.accountNumber || "-"}</td></tr>
          <tr><td style="padding: 6px 0; color: #888888;">Updated Balance</td><td style="padding: 6px 0; color: #111111; text-align: right;">${formatINR(receipt.updatedBalance)}</td></tr>
          <tr><td style="padding: 6px 0; color: #888888;">Branch</td><td style="padding: 6px 0; color: #111111; text-align: right;">${receipt.branch || "Kochi Main"}</td></tr>
          <tr><td style="padding: 6px 0; color: #888888;">Timestamp</td><td style="padding: 6px 0; color: #111111; text-align: right;">${new Date(receipt.timestamp || Date.now()).toLocaleString("en-IN")}</td></tr>
        </table>
      </div>
      <div style="text-align: center; padding-top: 15px; border-top: 1px solid #f0f0f0; color: #aaaaaa; font-size: 11px;">
        &copy; ${new Date().getFullYear()} Flowly Finance. All rights reserved.
      </div>
    </div>
  `;

  const attachments = pdfBuffer
    ? [{ filename: `Withdrawal_Receipt_${receipt.receiptNumber}.pdf`, content: pdfBuffer }]
    : [];

  if (!transporter) {
    console.log(`\n[SMTP DEV FALLBACK] WITHDRAWAL RECEIPT EMAIL to: ${targetEmail} (Receipt: ${receipt.receiptNumber})\n`);
    return { success: true, fallback: true };
  }

  try {
    const info = await transporter.sendMail({
      from: fromEmail,
      to: targetEmail,
      subject: `Cash Withdrawal Receipt ${receipt.receiptNumber} - Flowly Finance`,
      html: htmlContent,
      attachments,
    });
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.warn(`[SMTP WITHDRAWAL EMAIL FAILED] ${err.message}`);
    return { success: true, fallback: true, error: err.message };
  }
};

/**
 * Send EMI due-date reminder email (sent 5 days before the installment is due).
 * @param {string} email
 * @param {object} d
 * @param {string} d.userName
 * @param {string} d.loanNumber
 * @param {number} d.installmentNo
 * @param {number} d.emiAmount
 * @param {string|Date} d.dueDate
 * @param {number} d.daysLeft
 */
export const sendEmiReminderEmail = async (email, d = {}) => {
  if (!email) return { success: false, message: "No email address provided" };
  const transporter = getTransporter();
  const fromEmail = process.env.SMTP_FROM || `"Flowly Finance" <no-reply@flowlyfinance.com>`;
  const targetEmail = TEMP_TARGET_EMAIL || email;

  const formatINR = (n) =>
    `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dueText = new Date(d.dueDate).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const whenText = d.daysLeft === 1 ? "tomorrow" : `in ${d.daysLeft} days`;

  const row = (label, value, bold = false) =>
    `<tr><td style="padding: 6px 0; color: #888888;">${label}</td><td style="padding: 6px 0; color: #111111; text-align: right;${bold ? " font-weight: bold;" : ""}">${value}</td></tr>`;

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px; background-color: #ffffff;">
      <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #f0f0f0;">
        <h2 style="color: #5B2E91; margin: 0;">Flowly Finance</h2>
      </div>
      <div style="padding: 20px 0;">
        <h3 style="color: #D97706; margin-top: 0;">📅 EMI Payment Reminder</h3>
        <p style="color: #333333; line-height: 1.5;">Dear <strong>${d.userName || "Customer"}</strong>,</p>
        <p style="color: #555555; line-height: 1.6;">
          Your loan EMI of <strong>${formatINR(d.emiAmount)}</strong> is due <strong>${whenText}</strong> (${dueText}).
          Please keep sufficient balance in your account or pay from the Flowly Finance app to avoid late fees.
        </p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 13px;">
          ${row("Loan Number", d.loanNumber || "-", true)}
          ${row("Installment No.", `#${d.installmentNo}`)}
          ${row("Due Date", dueText)}
          ${row("EMI Amount", formatINR(d.emiAmount), true)}
        </table>
        <p style="color: #999999; font-size: 12px; line-height: 1.4;">If you have already paid this installment, please ignore this email.</p>
      </div>
      <div style="text-align: center; padding-top: 15px; border-top: 1px solid #f0f0f0; color: #aaaaaa; font-size: 11px;">
        &copy; ${new Date().getFullYear()} Flowly Finance. All rights reserved.
      </div>
    </div>
  `;

  if (!transporter) {
    console.log(`\n[SMTP DEV FALLBACK] EMI REMINDER EMAIL to: ${targetEmail} (Intended for: ${email}) - ${d.loanNumber} #${d.installmentNo} - ${formatINR(d.emiAmount)} due ${dueText}\n`);
    return { success: true, fallback: true };
  }

  try {
    const info = await transporter.sendMail({
      from: fromEmail,
      to: targetEmail,
      subject: `EMI Reminder: ${formatINR(d.emiAmount)} due ${whenText} - Flowly Finance`,
      html: htmlContent,
    });
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.warn(`[SMTP EMI REMINDER EMAIL FAILED] ${err.message}`);
    return { success: true, fallback: true, error: err.message };
  }
};