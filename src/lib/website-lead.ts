/**
 * A lead sent from a website form (Contact Form 7 on isto.ae, isto.ro, isto.ua) through n8n.
 * This file only reads and checks the payload; saving is in `website-leads.ts`.
 *
 * Expected body:
 * {
 *   "site": "isto.ae",
 *   "submission_id": "6f1c…",          // unique per submission; a retry with the same id changes nothing
 *   "form_id": "157", "form_title": "Join Form",
 *   "page_url": "https://isto.ae/contacts/", "submitted_at": "2026-11-17T11:00:00Z",
 *   "fields": { "your-name": "Sara", "your-tel": "+971…", "your-email": "…", "your-message": "…" },
 *   "utm": { "utm_source": "google", "utm_campaign": "…" }   // optional
 * }
 */

export type WebsiteLeadInput = {
  site: string;
  submissionId: string;
  formId: string | null;
  formName: string;
  pageUrl: string | null;
  createdTime: Date;
  regionCode: string | null;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  campaignName: string | null;
  answers: Record<string, string>;
};

/** Which region a site's leads belong to. */
const SITE_REGIONS: Record<string, string> = { ae: "dubai", ro: "romania" };

export function siteRegion(site: string) {
  const tld = site.toLowerCase().split(".").pop() ?? "";
  return SITE_REGIONS[tld] ?? null;
}

/** Form field names that are CF7 plumbing, consent boxes or spam traps, not answers. */
const SKIP = /^(_wpcf7|_wpnonce|g-recaptcha|recaptcha|cf-turnstile|honeypot|acceptance|consent|privacy|policy|agree|gdpr)/i;

const NAME = /(^|[\s_-])(full[\s_-]?name|first[\s_-]?name|name|ім['ʼ’]?я|имя|nume)([\s_-]|$)/i;
const PHONE = /(^|[\s_-])(tel|phone|telephone|mobile|телефон|номер|whats[\s_-]?app|telefon)([\s_-]|$)/i;
const EMAIL = /(^|[\s_-])(e-?mail|mail|пошта|почта)([\s_-]|$)/i;
const CITY = /(^|[\s_-])(city|місто|город|country|країна|oraș|oras|location)([\s_-]|$)/i;

/** "your-message" → "Message", "project_type" → "Project type". */
export function fieldLabel(key: string) {
  const t = key.replace(/^your[-_]/i, "").replace(/[-_]+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : key;
}

function text(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(", ");
  if (typeof v === "object") return "";
  return String(v).trim();
}

export function parseWebsiteLead(body: unknown, now = new Date()): { ok: true; lead: WebsiteLeadInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "body must be a JSON object" };
  const b = body as Record<string, unknown>;

  const site = text(b.site).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(site)) return { ok: false, error: "site is required, e.g. isto.ae" };
  const submissionId = text(b.submission_id);
  if (!/^[\w.:-]{6,80}$/.test(submissionId)) return { ok: false, error: "submission_id is required" };
  const formName = text(b.form_title) || text(b.form_name);
  if (!formName) return { ok: false, error: "form_title is required" };
  if (!b.fields || typeof b.fields !== "object" || Array.isArray(b.fields)) return { ok: false, error: "fields must be an object" };

  let fullName: string | null = null;
  let phone: string | null = null;
  let email: string | null = null;
  let city: string | null = null;
  const answers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(b.fields as Record<string, unknown>)) {
    const v = text(raw);
    if (!v || SKIP.test(key)) continue;
    const k = key.toLowerCase();
    if (!email && (EMAIL.test(k) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) email = v;
    else if (!phone && PHONE.test(k)) phone = v;
    else if (!fullName && NAME.test(k)) fullName = v;
    else if (!city && CITY.test(k)) city = v;
    else answers[fieldLabel(key)] = v.slice(0, 4000);
  }
  if (!fullName && !phone && !email) return { ok: false, error: "form has no name, phone or e-mail" };

  const pageUrl = text(b.page_url) || null;
  if (pageUrl) answers["Сторінка"] = pageUrl;

  const utm = (b.utm && typeof b.utm === "object" ? b.utm : {}) as Record<string, unknown>;
  const utmSource = text(utm.utm_source);
  const utmCampaign = text(utm.utm_campaign);
  if (utmSource) answers["UTM source"] = utmSource;
  if (text(utm.utm_medium)) answers["UTM medium"] = text(utm.utm_medium);

  const at = new Date(text(b.submitted_at));
  // A wrong or future clock on the site must not move the lead around the timeline.
  const createdTime = Number.isNaN(at.getTime()) || at > now ? now : at;

  return {
    ok: true,
    lead: {
      site,
      submissionId,
      formId: text(b.form_id) || null,
      formName,
      pageUrl,
      createdTime,
      regionCode: siteRegion(site),
      fullName,
      phone,
      email,
      city,
      campaignName: utmCampaign || null,
      answers,
    },
  };
}

/** Key the lead is stored under, so the same submission is never saved twice. */
export const websiteLeadKey = (l: Pick<WebsiteLeadInput, "site" | "submissionId">) => `web:${l.site}:${l.submissionId}`;
