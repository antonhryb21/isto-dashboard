/**
 * Business day boundaries. Meta reports days in the ad account's timezone (Dubai for ISTO), so "today",
 * "1 day" and "1 month" use the same clock; otherwise after midnight in Kyiv the dashboard still showed yesterday.
 * Change with NEXT_PUBLIC_APP_TIMEZONE in Vercel.
 */
export const APP_TIMEZONE = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Dubai";

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** YYYY-MM-DD of a moment in the app timezone. */
export function localDate(d: Date = new Date()) {
  return fmt.format(d);
}

/** YYYY-MM-DD `offset` days before today in the app timezone. */
export function daysAgo(offset: number) {
  const t = Date.parse(localDate() + "T00:00:00Z") - offset * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Minutes since a moment (server render time). */
export function minutesSince(d: Date) {
  return Math.round((Date.now() - d.getTime()) / 60_000);
}
