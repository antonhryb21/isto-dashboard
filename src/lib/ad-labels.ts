/** Meta delivery statuses and campaign objectives in the team's language. */
const STATUS: Record<string, string> = {
  PAUSED: "на паузі",
  ADSET_PAUSED: "група на паузі",
  CAMPAIGN_PAUSED: "кампанія на паузі",
  ARCHIVED: "в архіві",
  DELETED: "видалено",
  DISAPPROVED: "відхилено",
  PENDING_REVIEW: "на перевірці",
  PENDING_BILLING_INFO: "чекає оплати",
  WITH_ISSUES: "є проблеми",
  IN_PROCESS: "обробляється",
  PREAPPROVED: "схвалено наперед",
};

export function adStatusLabel(status: string | null | undefined) {
  if (!status || status === "ACTIVE") return null;
  return STATUS[status.toUpperCase()] ?? status.toLowerCase().replace(/_/g, " ");
}

const OBJECTIVE: Record<string, string> = {
  OUTCOME_LEADS: "Ліди",
  LEAD_GENERATION: "Ліди",
  OUTCOME_ENGAGEMENT: "Взаємодія",
  POST_ENGAGEMENT: "Взаємодія",
  PAGE_LIKES: "Підписники",
  MESSAGES: "Повідомлення",
  OUTCOME_AWARENESS: "Охоплення",
  BRAND_AWARENESS: "Охоплення",
  REACH: "Охоплення",
  OUTCOME_TRAFFIC: "Трафік",
  LINK_CLICKS: "Трафік",
  OUTCOME_SALES: "Продажі",
  CONVERSIONS: "Конверсії",
  VIDEO_VIEWS: "Перегляди відео",
  OUTCOME_APP_PROMOTION: "Застосунок",
};

export function objectiveLabel(objective: string | null | undefined) {
  if (!objective) return "—";
  return OBJECTIVE[objective.toUpperCase()] ?? objective.toLowerCase().replace(/^outcome_/, "").replace(/_/g, " ");
}

/** Below this many qualified leads a "cost per qualified lead" is an estimate, not a result. */
export const MIN_SAMPLE = 5;
