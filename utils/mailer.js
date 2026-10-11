import nodemailer from "nodemailer";

// Temporary email override for development only.
// Keep null to send to the actual recipient.
const TEMP_TARGET_EMAIL = null;

/**
 * Creates a Nodemailer transporter using Render environment variables.
 */
const getTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT
    ? Number(process.env.SMTP_PORT)
    : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (
    !host ||
    !user ||
    !pass ||
    user.includes("your_email") ||
    pass.includes("your_app_password")
  ) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user: user.trim(),
      pass: pass.replace(/\s+/g, ""),
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
};

/**
 * Sends an email and throws if SMTP is not configured or sending fails.
 * Never logs OTP values or email content.
 */
const sendMailOrThrow = async ({
  transporter,
  from,
  to,
  subject,
  html,
  attachments,
}) => {
  if (!transporter) {
    console.error("[SMTP CONFIG ERROR] SMTP credentials are missing.");
    throw new Error("Email service is not configured");
  }

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      html,
      ...(attachments ? { attachments } : {}),
    });

    console.log(
      `[SMTP] Email accepted by provider. Message ID: ${info.messageId}`
    );

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (err) {
    console.error(
      `[SMTP SEND FAILED] ${err.code || "SMTP_ERROR"}: ${err.message}`
    );

    throw new Error("Unable to send email");
  }
};

/**
 * Shared email template.
 */
const emailLayout = (title, content) => `
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;border:1px solid #e0e0e0;border-radius:10px;background:#fff;">
    <div style="text-align:center;padding-bottom:20px;border-bottom:1px solid #f0f0f0;">
      <h2 style="color:#5B2E91;margin:0;">Flowly Finance</h2>
    </div>
    <div style="padding:20px 0;">
      <h3 style="color:#333;">${title}</h3>
      ${content}
    </div>
    <div style="text-align:center;padding-top:15px;border-top:1px solid #f0f0f0;color:#aaa;font-size:11px;">
      &copy; ${new Date().getFullYear()} Flowly Finance. All rights reserved.
    </div>
  </div>
`;

const formatINR = (amount) =>
  `₹${Number(amount || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatDate = (date) =>
  new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

const formatDateTime = (date) =>
  new Date(date).toLocaleString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const tableRow = (label, value, bold = false) => `
  <tr>
    <td style="padding:6px 0;color:#888;">${label}</td>
    <td style="padding:6px 0;color:#111;text-align:right;${bold ? "font-weight:bold;" : ""}">
      ${value ?? "-"}
    </td>
  </tr>
`;

/**
 * OTP EMAIL
 */
export const sendOTPEmail = async (
  email,
  otp,
  purpose = "registration"
) => {
  const transporter = getTransporter();
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
  const targetEmail = TEMP_TARGET_EMAIL || email;

  if (!email || !otp) {
    throw new Error("Email and OTP are required");
  }

  const purposeTitleMap = {
    registration: "Account Registration OTP",
    generate_mpin: "Generate MPIN Verification Code",
    reset_mpin: "Reset MPIN Verification Code",
    login: "Login Verification Code",
  };

  const title =
    purposeTitleMap[purpose] || "Verification Code";

  const html = emailLayout(
    title,
    `
      <p style="color:#666;line-height:1.5;">
        Use the verification code below to complete your process.
        This code is valid for <strong>5 minutes</strong>.
      </p>
      <div style="text-align:center;margin:30px 0;">
        <span style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#5B2E91;background:#F3EEF9;padding:12px 24px;border-radius:8px;">
          ${otp}
        </span>
      </div>
      <p style="color:#999;font-size:12px;">
        Intended account: ${email}
      </p>
      <p style="color:#999;font-size:12px;">
        If you did not request this code, please ignore this email.
      </p>
    `
  );

  return sendMailOrThrow({
    transporter,
    from: fromEmail,
    to: targetEmail,
    subject: "Your Flowly Finance verification code",
    html,
  });
};

/**
 * FIXED DEPOSIT APPROVAL EMAIL
 */
export const sendFDApprovalEmail = async (
  email,
  fd,
  certificateBuffer
) => {
  const transporter = getTransporter();
  const fromEmail =
    process.env.SMTP_FROM || process.env.SMTP_USER;
  const targetEmail = TEMP_TARGET_EMAIL || email;

  const html = emailLayout(
    "Your Fixed Deposit is now Active",
    `
      <p>Dear <strong>${fd.userName || "Customer"}</strong>,</p>
      <p>Your Fixed Deposit has been approved and activated.</p>

      <table style="width:100%;border-collapse:collapse;">
        ${tableRow("FD Number", fd.fdNumber, true)}
        ${tableRow("Principal Amount", formatINR(fd.principalAmount))}
        ${tableRow("Interest Rate", `${fd.interestRate}% p.a.`)}
        ${tableRow("Tenure", `${fd.tenureMonths} month(s)`)}
        ${tableRow("Maturity Date", formatDate(fd.maturityDate))}
        ${tableRow("Maturity Amount", formatINR(fd.maturityAmount), true)}
      </table>

      ${
        fd.certificateUrl
          ? `<p><a href="${fd.certificateUrl}">View / Download Certificate</a></p>`
          : ""
      }
    `
  );

  const attachments = certificateBuffer
    ? [
        {
          filename: `${fd.fdNumber}-certificate.pdf`,
          content: certificateBuffer,
          contentType: "application/pdf",
        },
      ]
    : undefined;

  return sendMailOrThrow({
    transporter,
    from: fromEmail,
    to: targetEmail,
    subject: `Your Fixed Deposit ${fd.fdNumber} is Active - Flowly Finance`,
    html,
    attachments,
  });
};

/**
 * TOP-UP RECEIPT EMAIL
 */
export const sendTopUpReceiptEmail = async (
  email,
  receipt,
  userName = "Customer"
) => {
  const transporter = getTransporter();
  const fromEmail =
    process.env.SMTP_FROM || process.env.SMTP_USER;
  const targetEmail = TEMP_TARGET_EMAIL || email;

  const card = receipt.paymentMethod?.last4
    ? `${(receipt.paymentMethod.brand || "Card").toUpperCase()} •••• ${receipt.paymentMethod.last4}`
    : "Card";

  const html = emailLayout(
    "Money added to your account",
    `
      <p>Dear <strong>${userName}</strong>,</p>
      <p>${formatINR(receipt.amount)} has been added to your account.</p>
      <table style="width:100%;border-collapse:collapse;">
        ${tableRow("Reference No.", receipt.receiptNumber, true)}
        ${tableRow("Account", `${receipt.account?.accountNumber || ""} (${receipt.account?.accountType || ""})`)}
        ${tableRow("Paid with", card)}
        ${tableRow("Date & time", formatDateTime(receipt.completedAt || Date.now()))}
        ${tableRow("Amount added", formatINR(receipt.amount), true)}
        ${tableRow("New balance", formatINR(receipt.balanceAfter), true)}
      </table>
    `
  );

  return sendMailOrThrow({
    transporter,
    from: fromEmail,
    to: targetEmail,
    subject: `Money added - ${formatINR(receipt.amount)} - Flowly Finance`,
    html,
  });
};

/**
 * CASH DEPOSIT RECEIPT EMAIL
 */
export const sendCashDepositReceiptEmail = async (
  email,
  receipt,
  userName = "Customer"
) => {
  const transporter = getTransporter();
  const fromEmail =
    process.env.SMTP_FROM || process.env.SMTP_USER;
  const targetEmail = TEMP_TARGET_EMAIL || email;

  const html = emailLayout(
    "Cash deposit received",
    `
      <p>Dear <strong>${userName}</strong>,</p>
      <p>${formatINR(receipt.amount)} was deposited at your branch.</p>
      <table style="width:100%;border-collapse:collapse;">
        ${tableRow("Reference No.", receipt.receiptNumber, true)}
        ${tableRow("Account", `${receipt.account?.accountNumber || ""} (${receipt.account?.accountType || ""})`)}
        ${tableRow("Branch", receipt.branch || "-")}
        ${tableRow("Date & time", formatDateTime(receipt.completedAt || Date.now()))}
        ${tableRow("Amount deposited", formatINR(receipt.amount), true)}
        ${tableRow("New balance", formatINR(receipt.updatedBalance), true)}
      </table>
    `
  );

  return sendMailOrThrow({
    transporter,
    from: fromEmail,
    to: targetEmail,
    subject: `Cash deposit - ${receipt.receiptNumber} - Flowly Finance`,
    html,
  });
};

/**
 * ACCOUNT LOCKOUT / SECURITY ALERT EMAIL
 */
export const sendAccountLockoutEmail = async (
  email,
  userName = "Customer"
) => {
  const transporter = getTransporter();
  const fromEmail =
    process.env.SMTP_FROM || process.env.SMTP_USER;
  const targetEmail = TEMP_TARGET_EMAIL || email;

  const html = emailLayout(
    "Security Alert: Account Suspended",
    `
      <p>Dear <strong>${userName}</strong>,</p>
      <p>Your Flowly Finance account has been temporarily suspended for 24 hours because of four consecutive incorrect login or MPIN attempts.</p>
      <ul>
        <li>You can reset your MPIN using the Forgot MPIN option.</li>
        <li>Otherwise, access will automatically restore after 24 hours.</li>
        <li>If you did not perform these attempts, contact support.</li>
      </ul>
    `
  );

  return sendMailOrThrow({
    transporter,
    from: fromEmail,
    to: targetEmail,
    subject: "Security Alert: Account Temporarily Suspended - Flowly Finance",
    html,
  });
};

/**
 * VIDEO KYC SCHEDULE EMAIL
 */
export const sendVideoKycScheduleEmail = async (
  email,
  details = {}
) => {
  const transporter = getTransporter();
  const fromEmail =
    process.env.SMTP_FROM || process.env.SMTP_USER;
  const targetEmail = TEMP_TARGET_EMAIL || email;

  const {
    userName = "Customer",
    scheduledAt,
    durationMinutes = 30,
    officerName = "Verification Officer",
    notes = "",
    isRescheduled = false,
  } = details;

  const formattedTime = new Date(scheduledAt).toLocaleString(
    "en-IN",
    {
      timeZone: "Asia/Kolkata",
      dateStyle: "full",
      timeStyle: "short",
    }
  );

  const title = isRescheduled
    ? "KYC Video Call Schedule Updated"
    : "KYC Video Call Scheduled";

  const html = emailLayout(
    title,
    `
      <p>Dear <strong>${userName}</strong>,</p>
      <p>Your video KYC call schedule has been ${
        isRescheduled ? "updated" : "assigned"
      } by <strong>${officerName}</strong>.</p>

      <table style="width:100%;border-collapse:collapse;">
        ${tableRow("Date & time (IST)", formattedTime)}
        ${tableRow("Duration", `${durationMinutes} minutes`)}
        ${tableRow("Assigned Officer", officerName)}
        ${notes ? tableRow("Officer Notes", notes) : ""}
      </table>

      <p>Keep your PAN and Aadhaar documents ready for your call.</p>
      <p>Ensure you have a stable internet connection and allow camera and microphone access.</p>
      <p>You will receive an automated reminder before the call.</p>
    `
  );

  return sendMailOrThrow({
    transporter,
    from: fromEmail,
    to: targetEmail,
    subject: isRescheduled
      ? "[Updated] Your Video KYC Call Schedule - Flowly Finance"
      : `Your Video KYC Call is Scheduled for ${formattedTime} - Flowly Finance`,
    html,
  });
};

/**
 * VIDEO KYC REMINDER EMAIL
 */
export const sendVideoKycReminderEmail = async (
  email,
  details = {}
) => {
  const transporter = getTransporter();
  const fromEmail =
    process.env.SMTP_FROM || process.env.SMTP_USER;
  const targetEmail = TEMP_TARGET_EMAIL || email;

  const {
    userName = "Customer",
    scheduledAt,
    durationMinutes = 30,
    officerName = "Verification Officer",
  } = details;

  const formattedTime = new Date(scheduledAt).toLocaleString(
    "en-IN",
    {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    }
  );

  const html = emailLayout(
    "Reminder: Video KYC Call Starts Soon",
    `
      <p>Dear <strong>${userName}</strong>,</p>
      <p>Your video KYC call with <strong>${officerName}</strong> starts soon.</p>
      <p><strong>Date and time:</strong> ${formattedTime} IST</p>
      <p><strong>Duration:</strong> ${durationMinutes} minutes</p>
      <p>Please keep your PAN and Aadhaar documents ready and open the Flowly app before your call.</p>
    `
  );

  return sendMailOrThrow({
    transporter,
    from: fromEmail,
    to: targetEmail,
    subject: "Reminder: Your Video KYC call starts soon - Flowly Finance",
    html,
  });
};

/**
 * VIDEO KYC CANCELLATION EMAIL
 */
export const sendVideoKycCancelledEmail = async (
  email,
  details = {}
) => {
  const transporter = getTransporter();
  const fromEmail =
    process.env.SMTP_FROM || process.env.SMTP_USER;
  const targetEmail = TEMP_TARGET_EMAIL || email;

  const { userName = "Customer", reason = "" } = details;

  const html = emailLayout(
    "Video KYC Call Cancelled",
    `
      <p>Dear <strong>${userName}</strong>,</p>
      <p>Your scheduled Video KYC verification call has been cancelled.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
      <p>Our verification team will contact you regarding a new schedule.</p>
    `
  );

  return sendMailOrThrow({
    transporter,
    from: fromEmail,
    to: targetEmail,
    subject: "Notice: Video KYC Call Cancelled - Flowly Finance",
    html,
  });
};

/**
 * CASH WITHDRAWAL RECEIPT EMAIL
 */
export const sendWithdrawalReceiptEmail = async (
  email,
  receipt,
  pdfBuffer
) => {
  if (!email) {
    throw new Error("Recipient email is required");
  }

  const transporter = getTransporter();
  const fromEmail =
    process.env.SMTP_FROM || process.env.SMTP_USER;
  const targetEmail = TEMP_TARGET_EMAIL || email;

  const html = emailLayout(
    "Cash Withdrawal Receipt",
    `
      <p>Dear <strong>${receipt.customerName || "Customer"}</strong>,</p>
      <p>Your cash withdrawal request of <strong>${formatINR(receipt.amount)}</strong> has been processed.</p>

      <table style="width:100%;border-collapse:collapse;">
        ${tableRow("Receipt Number", receipt.receiptNumber, true)}
        ${tableRow("Amount Disbursed", `-${formatINR(receipt.amount)}`, true)}
        ${tableRow("Account Number", receipt.accountNumber || "-")}
        ${tableRow("Updated Balance", formatINR(receipt.updatedBalance))}
        ${tableRow("Branch", receipt.branch || "Kochi Main")}
        ${tableRow("Timestamp", formatDateTime(receipt.timestamp || Date.now()))}
      </table>
    `
  );

  const attachments = pdfBuffer
    ? [
        {
          filename: `Withdrawal_Receipt_${receipt.receiptNumber}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ]
    : undefined;

  return sendMailOrThrow({
    transporter,
    from: fromEmail,
    to: targetEmail,
    subject: `Cash Withdrawal Receipt ${receipt.receiptNumber} - Flowly Finance`,
    html,
    attachments,
  });
};

/**
 * EMI REMINDER EMAIL
 */
export const sendEmiReminderEmail = async (
  email,
  d = {}
) => {
  if (!email) {
    throw new Error("Recipient email is required");
  }

  const transporter = getTransporter();
  const fromEmail =
    process.env.SMTP_FROM || process.env.SMTP_USER;
  const targetEmail = TEMP_TARGET_EMAIL || email;

  const dueText = formatDate(d.dueDate);
  const whenText =
    d.daysLeft === 1 ? "tomorrow" : `in ${d.daysLeft} days`;

  const html = emailLayout(
    "EMI Payment Reminder",
    `
      <p>Dear <strong>${d.userName || "Customer"}</strong>,</p>
      <p>Your loan EMI of <strong>${formatINR(d.emiAmount)}</strong> is due ${whenText} (${dueText}).</p>

      <table style="width:100%;border-collapse:collapse;">
        ${tableRow("Loan Number", d.loanNumber || "-", true)}
        ${tableRow("Installment Number", `#${d.installmentNo}`)}
        ${tableRow("Due Date", dueText)}
        ${tableRow("EMI Amount", formatINR(d.emiAmount), true)}
      </table>

      <p>If you have already paid this installment, please ignore this email.</p>
    `
  );

  return sendMailOrThrow({
    transporter,
    from: fromEmail,
    to: targetEmail,
    subject: `EMI Reminder: ${formatINR(d.emiAmount)} due ${whenText} - Flowly Finance`,
    html,
  });
};