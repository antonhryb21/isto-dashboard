import "server-only";
import { JWT } from "google-auth-library";

const API = "https://sheets.googleapis.com/v4/spreadsheets";

let jwt: JWT | null = null;
function auth() {
  if (jwt) return jwt;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!b64) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not set");
  const creds = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as { client_email: string; private_key: string };
  jwt = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return jwt;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const { token } = await auth().getAccessToken();
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Google Sheets ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

const q = (sheet: string) => `'${sheet.replace(/'/g, "''")}'`;

export async function listTabs(spreadsheetId: string): Promise<string[]> {
  const r = await call<{ sheets: { properties: { title: string } }[] }>(
    `${API}/${spreadsheetId}?fields=sheets.properties.title`,
  );
  return r.sheets.map((s) => s.properties.title);
}

export async function spreadsheetTitle(spreadsheetId: string): Promise<string> {
  const r = await call<{ properties: { title: string } }>(`${API}/${spreadsheetId}?fields=properties.title`);
  return r.properties.title;
}

/** All values of a tab as strings, row 1 = header. */
export async function readTab(spreadsheetId: string, sheet: string): Promise<string[][]> {
  const r = await call<{ values?: string[][] }>(
    `${API}/${spreadsheetId}/values/${encodeURIComponent(q(sheet))}?valueRenderOption=FORMATTED_VALUE`,
  );
  return r.values ?? [];
}

/** Write single cells. `cells` = [{ row: 1-based, col: 0-based, value }]. */
export async function writeCells(
  spreadsheetId: string,
  sheet: string,
  cells: { row: number; col: number; value: string }[],
) {
  if (!cells.length) return;
  await call(`${API}/${spreadsheetId}/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: cells.map((c) => ({ range: `${q(sheet)}!${colLetter(c.col)}${c.row}`, values: [[c.value]] })),
    }),
  });
}

export async function appendRow(spreadsheetId: string, sheet: string, values: string[]) {
  await call(
    `${API}/${spreadsheetId}/values/${encodeURIComponent(`${q(sheet)}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [values] }) },
  );
}

export function colLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
