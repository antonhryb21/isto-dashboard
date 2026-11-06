/**
 * ISTO assets. IDs are not secret; tokens live in environment variables.
 * Override any of these with env vars without touching code.
 */
export const META = {
  apiVersion: process.env.META_API_VERSION ?? "v25.0",
  adAccountIds: (process.env.META_AD_ACCOUNT_IDS ?? "338101002044297,1710957566057565")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  pageId: process.env.META_PAGE_ID ?? "305763869547948",
  igUserId: process.env.META_IG_USER_ID ?? "17841402182580871",
};

/** Tabs that are summaries or helpers, never raw lead lists. Skipped when auto-discovering. */
export const NON_LEAD_TABS = [
  "all_leads_system",
  "all leads",
  "copy of all leads",
  "helper",
  "isto_status_history",
  "a/b test",
  "dashboard",
];

export const DEFAULT_REGIONS = [
  { code: "dubai", name: "Dubai", keywords: ["dubai", "uae", "оае", "дубай"], currency: "AED", sortOrder: 1 },
  { code: "eu", name: "EU", keywords: ["eu", "europe", "європа"], currency: "EUR", sortOrder: 2 },
  { code: "romania", name: "Romania", keywords: ["romania", "румунія", "ro_", " ro "], currency: "EUR", sortOrder: 3 },
];

export const DEFAULT_LEAD_SPREADSHEETS = [
  { spreadsheetId: "1M-iUXpDPoEUfGPbNJpB2hQXgOogS_vRECXi_0O17hnA", regionCode: "dubai", historySheetName: "ISTO_Status_History" },
  { spreadsheetId: "1ivae8hTOVHXsQVuVGPDrxRQYpAal9tLhjgvc5e-zn2I", regionCode: "eu", historySheetName: null },
];
