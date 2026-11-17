import "server-only";

export type GoogleCredentials = { client_email: string; private_key: string };

const rawValue = () => process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || "";
const b64Value = () => process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim() || "";

/**
 * Turn whatever was pasted into Vercel into the key's JSON text. Copying the file through an editor
 * or a chat often bends it: curly quotes (TextEdit), the whole thing wrapped in quotes, the file
 * base64-encoded into the plain variable, or the "\n" inside private_key turned into real line breaks.
 */
function normalize(text: string): string {
  let t = text.trim().replace(/^﻿/, "");
  if (!t.startsWith("{") && /^[A-Za-z0-9+/=\s]+$/.test(t)) {
    const decoded = Buffer.from(t, "base64").toString("utf8").trim();
    if (decoded.startsWith("{")) t = decoded;
  }
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"') && t.includes("{"))) t = t.slice(1, -1);
  t = t.replace(/[“”„″]/g, '"').replace(/[‘’]/g, "'");
  return t;
}

function parse(text: string): GoogleCredentials | { problem: string } {
  const t = normalize(text);
  if (!t.startsWith("{")) return { problem: "значення не схоже на JSON-ключ: воно має починатися з «{»" };
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(t);
  } catch {
    // Real line breaks inside the private key string make the JSON invalid; JSON wants "\n" there.
    try {
      obj = JSON.parse(t.replace(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----\s*/, (k) => k.replace(/\r?\n/g, "\\n")));
    } catch (e) {
      return { problem: `JSON не розбирається (${e instanceof Error ? e.message.replace(/".*?"/g, "…").slice(0, 80) : "помилка"}): скопіюйте файл ще раз, не через TextEdit` };
    }
  }
  const client_email = typeof obj.client_email === "string" ? obj.client_email : "";
  const private_key = typeof obj.private_key === "string" ? obj.private_key.replace(/\\n/g, "\n") : "";
  if (!client_email) return { problem: "у JSON немає client_email — це не ключ сервісного акаунта (можливо, ключ OAuth-клієнта)" };
  if (!private_key.includes("PRIVATE KEY")) return { problem: "у JSON немає private_key" };
  return { client_email, private_key };
}

/**
 * The Google service account key, used for Google Sheets and GA4. Vercel takes it either as the JSON
 * file pasted as-is (GOOGLE_SERVICE_ACCOUNT_JSON) or base64-encoded (GOOGLE_SERVICE_ACCOUNT_JSON_BASE64).
 */
export function googleCredentials(): GoogleCredentials | null {
  const r = googleCredentialsCheck();
  return "creds" in r ? r.creds : null;
}

/** The key, or what is wrong with it, in words for the person setting it up (never the key itself). */
export function googleCredentialsCheck(): { creds: GoogleCredentials } | { problem: string } {
  const raw = rawValue();
  const b64 = b64Value();
  if (!raw && !b64) return { problem: "у Vercel немає ключа сервісного акаунта Google (GOOGLE_SERVICE_ACCOUNT_JSON)" };
  const tried: string[] = [];
  for (const [name, text] of [
    ["GOOGLE_SERVICE_ACCOUNT_JSON", raw],
    ["GOOGLE_SERVICE_ACCOUNT_JSON_BASE64", b64 ? Buffer.from(b64, "base64").toString("utf8") : ""],
  ] as const) {
    if (!text) continue;
    const r = parse(text);
    if ("client_email" in r) return { creds: r };
    tried.push(`${name}: ${r.problem}`);
  }
  return { problem: `ключ сервісного акаунта у Vercel не читається — ${tried.join("; ")}` };
}

export const googleCredentialsSet = () => !!(rawValue() || b64Value());
