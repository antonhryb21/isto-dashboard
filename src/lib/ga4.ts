import "server-only";
import { JWT } from "google-auth-library";

/**
 * Google Analytics 4 for the website (isto.ae), read live through the GA4 Data API with the same
 * service account the dashboard uses for Google Sheets. The service account needs the Viewer role
 * on the GA4 property, and the "Google Analytics Data API" must be enabled in its Cloud project.
 */

export const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID?.trim() || null;

let jwt: JWT | null = null;
function auth() {
  if (jwt) return jwt;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!b64) throw new Ga4Error("Не задано GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 у Vercel.");
  const creds = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as { client_email: string; private_key: string };
  jwt = new JWT({ email: creds.client_email, key: creds.private_key, scopes: ["https://www.googleapis.com/auth/analytics.readonly"] });
  return jwt;
}

/** The service account's email, to tell the person whom to add in GA4. */
export function serviceAccountEmail(): string | null {
  try {
    const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
    return b64 ? (JSON.parse(Buffer.from(b64, "base64").toString("utf8")).client_email as string) : null;
  } catch {
    return null;
  }
}

export class Ga4Error extends Error {}

type Row = { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] };
type Report = { rows?: Row[] };

// GA4 data changes slowly; a short cache spares the API quota when several people open the page.
const cache = new Map<string, { at: number; value: Report }>();
const TTL_MS = 10 * 60_000;

async function runReport(body: Record<string, unknown>): Promise<Report> {
  if (!GA4_PROPERTY_ID) throw new Ga4Error("Не задано GA4_PROPERTY_ID у Vercel.");
  const key = JSON.stringify(body);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const { token } = await auth().getAccessToken();
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`, {
    method: "POST",
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: key,
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 403 && /has not been used|is disabled/i.test(text))
      throw new Ga4Error("Google Analytics Data API не увімкнено в проєкті Google Cloud сервісного акаунта.");
    if (res.status === 403) throw new Ga4Error("Сервісний акаунт не має доступу до ресурсу GA4: додайте його з роллю «Читач».");
    throw new Ga4Error(`GA4 ${res.status}: ${text.slice(0, 200)}`);
  }
  const value = (await res.json()) as Report;
  cache.set(key, { at: Date.now(), value });
  return value;
}

const num = (r: Row, i: number) => Number(r.metricValues?.[i]?.value ?? 0);
const dim = (r: Row, i: number) => r.dimensionValues?.[i]?.value ?? "";

const TOTALS = ["sessions", "totalUsers", "newUsers", "engagedSessions", "averageSessionDuration", "keyEvents", "screenPageViews"] as const;
export type SiteTotals = Record<(typeof TOTALS)[number], number> & { engagementRate: number };

async function totals(from: string, to: string): Promise<SiteTotals> {
  const r = await runReport({ dateRanges: [{ startDate: from, endDate: to }], metrics: TOTALS.map((name) => ({ name })) });
  const row = r.rows?.[0];
  const out = Object.fromEntries(TOTALS.map((k, i) => [k, row ? num(row, i) : 0])) as Record<(typeof TOTALS)[number], number>;
  return { ...out, engagementRate: out.sessions ? out.engagedSessions / out.sessions : 0 };
}

/** One table: a dimension with sessions, engaged sessions and key events, largest first. */
async function breakdown(dimension: string, from: string, to: string, limit: number) {
  const r = await runReport({
    dateRanges: [{ startDate: from, endDate: to }],
    dimensions: [{ name: dimension }],
    metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "keyEvents" }, { name: "totalUsers" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit,
  });
  return (r.rows ?? []).map((row) => {
    const sessions = num(row, 0);
    return {
      name: dim(row, 0) || "(не визначено)",
      sessions,
      users: num(row, 3),
      engagementRate: sessions ? num(row, 1) / sessions : 0,
      keyEvents: num(row, 2),
    };
  });
}

export type SiteBreakdownRow = Awaited<ReturnType<typeof breakdown>>[number];

async function daily(from: string, to: string) {
  const r = await runReport({
    dateRanges: [{ startDate: from, endDate: to }],
    dimensions: [{ name: "date" }],
    metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "keyEvents" }],
    orderBys: [{ dimension: { dimensionName: "date" } }],
    limit: 1000,
  });
  return (r.rows ?? []).map((row) => {
    const d = dim(row, 0);
    return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, sessions: num(row, 0), users: num(row, 1), keyEvents: num(row, 2) };
  });
}

/** Which events GA4 counts as key events (form sends, calls, WhatsApp clicks) and how often each fired. */
async function keyEventsByName(from: string, to: string) {
  const r = await runReport({
    dateRanges: [{ startDate: from, endDate: to }],
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "keyEvents" }],
    orderBys: [{ metric: { metricName: "keyEvents" }, desc: true }],
    limit: 20,
  });
  return (r.rows ?? []).map((row) => ({ name: dim(row, 0), count: num(row, 0) })).filter((x) => x.count > 0);
}

/** Everything the "Сайт" page shows, for the period and the one before it. */
export async function siteReport(from: string, to: string, prevFrom: string, prevTo: string) {
  const [now, prev, days, channels, sources, landing, countries, devices, keyEvents] = await Promise.all([
    totals(from, to),
    totals(prevFrom, prevTo),
    daily(from, to),
    breakdown("sessionDefaultChannelGroup", from, to, 12),
    breakdown("sessionSourceMedium", from, to, 12),
    breakdown("landingPage", from, to, 15),
    breakdown("country", from, to, 10),
    breakdown("deviceCategory", from, to, 5),
    keyEventsByName(from, to),
  ]);
  return { now, prev, days, channels, sources, landing, countries, devices, keyEvents };
}
