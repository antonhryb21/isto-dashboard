/**
 * ISTO assets. IDs are not secret; tokens live in environment variables.
 * Override any of these with env vars without touching code.
 */
export const META = {
  apiVersion: process.env.META_API_VERSION ?? "v27.0",
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
  { code: "eu", name: "EU", keywords: ["eu", "europe", "європа"], currency: "USD", sortOrder: 2 },
  { code: "romania", name: "Romania", keywords: ["romania", "румунія", "ro_", " ro "], currency: "USD", sortOrder: 3 },
];

export const DEFAULT_LEAD_SPREADSHEETS = [
  { spreadsheetId: "1M-iUXpDPoEUfGPbNJpB2hQXgOogS_vRECXi_0O17hnA", regionCode: "dubai", historySheetName: "ISTO_Status_History" },
  { spreadsheetId: "1ivae8hTOVHXsQVuVGPDrxRQYpAal9tLhjgvc5e-zn2I", regionCode: "eu", historySheetName: null },
];

/**
 * Accounts on the Competitors page. Ad Library page ids were looked up in the Meta Ad Library;
 * accounts without one get a keyword search link instead. More can be added in Admin.
 */
export const DEFAULT_COMPETITORS = [
  { username: "isto_architecture", name: "ISTO", isOwn: true, sortOrder: 0, adLibraryPageIds: ["305763869547948"] },
  { username: "iqosa", name: "IQOSA", isOwn: false, sortOrder: 1, adLibraryPageIds: ["738822572816046"] },
  { username: "b8architecture", name: "B8 Architecture", isOwn: false, sortOrder: 2, adLibraryPageIds: [] },
  { username: "yodezeen_architects", name: "YODEZEEN", isOwn: false, sortOrder: 3, adLibraryPageIds: [] },
  { username: "_saota", name: "SAOTA", isOwn: false, sortOrder: 4, adLibraryPageIds: [] },
  { username: "nkey.architects", name: "NKEY Architects", isOwn: false, sortOrder: 5, adLibraryPageIds: ["107783874508942", "234116866451525"] },
];

/** Lead response target: a lead still in "New" after this many minutes is overdue (highlighted in CRM, sent in alerts). */
export const SLA_MINUTES = Number(process.env.LEAD_SLA_MINUTES ?? 30);
/** Only recent leads count as overdue; older "New" ones are usually imported history. */
export const SLA_LOOKBACK_DAYS = 7;

/**
 * Working time for the response target, in the app timezone. A lead that arrives at night is not overdue
 * until the team has had SLA_MINUTES of working time. Env: LEAD_WORK_HOURS="9-19", LEAD_WORK_DAYS="1-5" (1 = Monday).
 */
export const WORK_HOURS = (() => {
  const [a, b] = (process.env.LEAD_WORK_HOURS ?? "9-19").split("-").map((v) => Number(v.trim().replace(":30", ".5")));
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? { start: a, end: b } : { start: 9, end: 19 };
})();
export const WORK_DAYS = (() => {
  const raw = process.env.LEAD_WORK_DAYS ?? "1-5";
  const days = new Set<number>();
  for (const part of raw.split(",")) {
    const [a, b] = part.split("-").map((v) => Number(v.trim()));
    if (!Number.isInteger(a)) continue;
    for (let d = a; d <= (Number.isInteger(b) ? b : a); d++) if (d >= 1 && d <= 7) days.add(d);
  }
  return days.size ? days : new Set([1, 2, 3, 4, 5]);
})();
