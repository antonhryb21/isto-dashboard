import "server-only";

export type GoogleCredentials = { client_email: string; private_key: string };

/**
 * The Google service account key, used for Google Sheets and GA4. Vercel takes it either as the JSON
 * file pasted as-is (GOOGLE_SERVICE_ACCOUNT_JSON) or base64-encoded (GOOGLE_SERVICE_ACCOUNT_JSON_BASE64).
 */
export function googleCredentials(): GoogleCredentials | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  const text = raw || (b64 ? Buffer.from(b64, "base64").toString("utf8") : "");
  if (!text) return null;
  try {
    const creds = JSON.parse(text) as GoogleCredentials;
    return creds.client_email && creds.private_key ? creds : null;
  } catch {
    return null;
  }
}

export const googleCredentialsSet = () => !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim());
