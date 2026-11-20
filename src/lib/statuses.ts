/** The CRM pipeline. `label` is what is written to Google Sheets. */
export const STATUSES = [
  { code: "new", label: "New", stage: "open", color: "#3b82f6" },
  { code: "contacted", label: "Contacted", stage: "open", color: "#06b6d4" },
  { code: "qualified", label: "Lead (Qualified)", stage: "open", color: "#10b981" },
  { code: "no_answer", label: "No answer", stage: "open", color: "#94a3b8" },
  { code: "meeting", label: "Meeting", stage: "open", color: "#f59e0b" },
  { code: "proposal", label: "Proposal sent", stage: "open", color: "#f97316" },
  { code: "won", label: "Won", stage: "won", color: "#16a34a" },
  { code: "lost", label: "Lost", stage: "lost", color: "#ef4444" },
  { code: "not_relevant", label: "Not relevant", stage: "junk", color: "#78716c" },
  { code: "job_inquiry", label: "Job inquiry", stage: "junk", color: "#a8a29e" },
  { code: "supplier", label: "Supplier", stage: "junk", color: "#b45309" },
  { code: "spam", label: "Spam", stage: "junk", color: "#e11d48" },
] as const;

export type StatusCode = (typeof STATUSES)[number]["code"];

export const STATUS_BY_CODE = Object.fromEntries(STATUSES.map((s) => [s.code, s])) as Record<
  StatusCode,
  (typeof STATUSES)[number]
>;

/** Funnel order used for "reached at least this stage". */
export const FUNNEL_ORDER: StatusCode[] = ["new", "contacted", "meeting", "proposal", "won"];

/** Statuses that count as a qualified (real) lead. */
export const QUALIFIED: StatusCode[] = ["contacted", "qualified", "meeting", "proposal", "won", "lost"];

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
  // Follow-up was retired: the next-contact date covers it, so the old label lands on Contacted.
  "follow-up": "contacted",
  "follow up": "contacted",
  followup: "contacted",
  follow_up: "contacted",
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
 * Strict version for external callers (the Telegram bot): accepts a code ("no_answer"),
 * a label ("No answer") or a known alias; returns null instead of guessing.
 */
export function parseStatus(raw: string | null | undefined): StatusCode | null {
  const key = (raw ?? "").trim().toLowerCase();
  if (!key) return null;
  if (STATUS_BY_CODE[key as StatusCode]) return key as StatusCode;
  const byLabel = STATUSES.find((s) => s.label.toLowerCase() === key);
  if (byLabel) return byLabel.code;
  return ALIASES[key] ?? null;
}

/** Labels of retired statuses, so old history entries still read as words. */
const RETIRED_LABELS: Record<string, string> = { follow_up: "Follow-up" };

export function statusLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return STATUS_BY_CODE[code as StatusCode]?.label ?? RETIRED_LABELS[code] ?? code;
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
