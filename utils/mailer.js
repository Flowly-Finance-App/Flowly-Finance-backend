import nodemailer from "nodemailer";

/**
 * Creates and returns a Nodemailer transporter instance using environment variables.
 */
const getTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null; // Return null if SMTP credentials are missing
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for other ports
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

  const purposeTitleMap = {
    registration: "Account Registration OTP",
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
        <p style="color: #999999; font-size: 12px; line-height: 1.4;">If you did not request this verification code, please ignore this email.</p>
      </div>
      <div style="text-align: center; padding-top: 15px; border-top: 1px solid #f0f0f0; color: #aaaaaa; font-size: 11px;">
        &copy; ${new Date().getFullYear()} Flowly Finance. All rights reserved.
      </div>
    </div>
  `;

  if (!transporter) {
    console.log(`\n=================================================`);
    console.log(`[SMTP DEV FALLBACK] Email to: ${email}`);
    console.log(`[SMTP DEV FALLBACK] Purpose: ${purpose}`);
    console.log(`[SMTP DEV FALLBACK] OTP Code: ${otp}`);
    console.log(`=================================================\n`);
    return { success: true, fallback: true };
  }

  const info = await transporter.sendMail({
    from: fromEmail,
    to: email,
    subject: `${otp} is your Flowly Finance verification code`,
    html: htmlContent,
  });

  return { success: true, messageId: info.messageId };
};
