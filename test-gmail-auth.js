import "dotenv/config";
import { google } from "googleapis";

const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);

console.log("Client ID loaded:", !!process.env.GMAIL_CLIENT_ID);
console.log("Client secret loaded:", !!process.env.GMAIL_CLIENT_SECRET);
console.log("Refresh token loaded:", !!process.env.GMAIL_REFRESH_TOKEN);

oauth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN,
});

try {
  const { token } = await oauth2Client.getAccessToken();

  console.log(
    token
      ? "SUCCESS: Google issued an access token."
      : "FAILED: No access token returned."
  );
} catch (error) {
  console.error("TOKEN REFRESH FAILED:", {
    code: error.code,
    status: error.response?.status,
    message: error.message,
    details: error.response?.data?.error,
    description: error.response?.data?.error_description,
  });
}