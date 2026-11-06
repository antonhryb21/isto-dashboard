/** The CRM pipeline. `label` is what is written to Google Sheets. */
export const STATUSES = [
  { code: "new", label: "New", stage: "open", color: "#60a5fa" },
  { code: "contacted", label: "Contacted", stage: "open", color: "#818cf8" },
  { code: "follow_up", label: "Follow-up", stage: "open", color: "#a78bfa" },
  { code: "no_answer", label: "No answer", stage: "open", color: "#94a3b8" },
  { code: "meeting", label: "Meeting", stage: "open", color: "#f59e0b" },
  { code: "proposal", label: "Proposal sent", stage: "open", color: "#f97316" },
  { code: "won", label: "Won", stage: "won", color: "#22c55e" },
  { code: "lost", label: "Lost", stage: "lost", color: "#ef4444" },
  { code: "not_relevant", label: "Not relevant", stage: "junk", color: "#64748b" },
  { code: "supplier", label: "Supplier", stage: "junk", color: "#64748b" },
  { code: "spam", label: "Spam", stage: "junk", color: "#475569" },
] as const;

export type StatusCode = (typeof STATUSES)[number]["code"];

export const STATUS_BY_CODE = Object.fromEntries(STATUSES.map((s) => [s.code, s])) as Record<
  StatusCode,
  (typeof STATUSES)[number]
>;

/** Funnel order used for "reached at least this stage". */
export const FUNNEL_ORDER: StatusCode[] = ["new", "contacted", "meeting", "proposal", "won"];

/** Statuses that count as a qualified (real) lead. */
export const QUALIFIED: StatusCode[] = ["contacted", "follow_up", "meeting", "proposal", "won", "lost"];

const ALIASES: Record<string, StatusCode> = {
  created: "new",
  "новый": "new",
  "новий": "new",
  new: "new",
  contacted: "contacted",
  "звʼязались": "contacted",
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
