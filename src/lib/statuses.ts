/** The CRM pipeline. `label` is what is written to Google Sheets. */
export const STATUSES = [
  { code: "new", label: "New", stage: "open", color: "#393e49" },
  { code: "contacted", label: "Contacted", stage: "open", color: "#5b7fa6" },
  { code: "qualified", label: "Lead (Qualified)", stage: "open", color: "#6f9a5c" },
  { code: "follow_up", label: "Follow-up", stage: "open", color: "#8a7fb0" },
  { code: "no_answer", label: "No answer", stage: "open", color: "#a5aab0" },
  { code: "meeting", label: "Meeting", stage: "open", color: "#c29a4b" },
  { code: "proposal", label: "Proposal sent", stage: "open", color: "#b4704a" },
  { code: "won", label: "Won", stage: "won", color: "#4f7a5e" },
  { code: "lost", label: "Lost", stage: "lost", color: "#a4513f" },
  { code: "not_relevant", label: "Not relevant", stage: "junk", color: "#60584d" },
  { code: "job_inquiry", label: "Job inquiry", stage: "junk", color: "#8c8a83" },
  { code: "supplier", label: "Supplier", stage: "junk", color: "#a39d8d" },
  { code: "spam", label: "Spam", stage: "junk", color: "#cec7b4" },
] as const;

export type StatusCode = (typeof STATUSES)[number]["code"];

export const STATUS_BY_CODE = Object.fromEntries(STATUSES.map((s) => [s.code, s])) as Record<
  StatusCode,
  (typeof STATUSES)[number]
>;

/** Funnel order used for "reached at least this stage". */
export const FUNNEL_ORDER: StatusCode[] = ["new", "contacted", "meeting", "proposal", "won"];

/** Statuses that count as a qualified (real) lead. */
export const QUALIFIED: StatusCode[] = ["contacted", "qualified", "follow_up", "meeting", "proposal", "won", "lost"];

/** Not a client at all (spam, a supplier, a job seeker…): left out of "real leads". Derived, so a new junk status is never missed. */
export const JUNK_CODES = STATUSES.filter((s) => s.stage === "junk").map((s) => s.code) as StatusCode[];

/** Nothing left to do with the lead: no reminders, no response-time clock. */
export const CLOSED_CODES = STATUSES.filter((s) => s.stage !== "open").map((s) => s.code) as StatusCode[];

const ALIASES: Record<string, StatusCode> = {
  created: "new",
  "новый": "new",
  "новий": "new",
  new: "new",
  contacted: "contacted",
  "звʼязались": "contacted",
  "lead (qualified)": "qualified",
  "lead qualified": "qualified",
  qualified: "qualified",
  "якісний": "qualified",
  "кваліфікований": "qualified",
  "follow-up": "follow_up",
  "follow up": "follow_up",
  followup: "follow_up",
  "no answer": "no_answer",
  "не відповідає": "no_answer",
  meeting: "meeting",
  "зустріч": "meeting",
  "proposal sent": "proposal",
  proposal: "proposal",
  "кп": "proposal",
  won: "won",
  "угода": "won",
  lost: "lost",
  "not relevant": "not_relevant",
  "не наш": "not_relevant",
  "job inquiry": "job_inquiry",
  "job": "job_inquiry",
  "вакансія": "job_inquiry",
  "резюме": "job_inquiry",
  supplier: "supplier",
  "підрядник": "supplier",
  spam: "spam",
  "spam / supplier": "spam",
};

export function normalizeStatus(raw: string | null | undefined): StatusCode {
  const key = (raw ?? "").trim().toLowerCase();
  if (!key) return "new";
  return ALIASES[key] ?? (STATUS_BY_CODE[key as StatusCode] ? (key as StatusCode) : "new");
}

/** Index of a status in the funnel; junk/lost statuses map to the last real stage they imply. */
export function funnelDepth(code: StatusCode): number {
  switch (code) {
    case "new":
    case "no_answer":
      return 0;
    case "contacted":
    case "qualified":
    case "follow_up":
    case "lost":
      return 1;
    case "meeting":
      return 2;
    case "proposal":
      return 3;
    case "won":
      return 4;
    default:
      return -1; // spam, supplier, not relevant: out of the funnel
  }
}

/**
 * Strict version for external callers (the Telegram bot): accepts a code ("follow_up"),
 * a label ("Follow-up") or a known alias; returns null instead of guessing.
 */
export function parseStatus(raw: string | null | undefined): StatusCode | null {
  const key = (raw ?? "").trim().toLowerCase();
  if (!key) return null;
  if (STATUS_BY_CODE[key as StatusCode]) return key as StatusCode;
  const byLabel = STATUSES.find((s) => s.label.toLowerCase() === key);
  if (byLabel) return byLabel.code;
  return ALIASES[key] ?? null;
}

/** Reasons offered when a lead is closed without a deal; stored as the text itself. */
export const LOST_REASONS = [
  "Задорого",
  "Малий бюджет / не наш масштаб",
  "Не виходить на звʼязок",
  "Обрав іншу компанію",
  "Не та послуга",
  "Не той регіон",
  "Відклав / передумав",
  "Інше",
] as const;

/** Statuses where a reason is expected. */
export const NEEDS_REASON: StatusCode[] = ["lost", "not_relevant"];
