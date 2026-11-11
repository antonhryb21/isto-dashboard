import { APP_TIMEZONE } from "@/lib/dates";
import { SLA_MINUTES, WORK_DAYS, WORK_HOURS } from "@/lib/config";

const DAY = 86_400_000;
const HOUR = 3_600_000;

const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Milliseconds to add to a UTC instant to read it as wall-clock time in the app timezone. */
function offsetMs(d: Date) {
  const p = Object.fromEntries(parts.formatToParts(d).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000;
}

const isWorkDay = (localDayStart: number) => WORK_DAYS.has(new Date(localDayStart).getUTCDay() || 7);

/** Working minutes between two moments (only work hours on work days count). */
export function businessMinutes(from: Date, to: Date = new Date()) {
  if (to.getTime() <= from.getTime()) return 0;
  const off = offsetMs(to);
  const a = from.getTime() + off;
  const b = to.getTime() + off;
  let total = 0;
  for (let day = Math.floor(a / DAY) * DAY; day < b; day += DAY) {
    if (!isWorkDay(day)) continue;
    const s = Math.max(a, day + WORK_HOURS.start * HOUR);
    const e = Math.min(b, day + WORK_HOURS.end * HOUR);
    if (e > s) total += e - s;
  }
  return Math.round(total / 60_000);
}

/** Is this moment inside working time? */
export function isWorkingTime(d: Date = new Date()) {
  const t = d.getTime() + offsetMs(d);
  const day = Math.floor(t / DAY) * DAY;
  return isWorkDay(day) && t >= day + WORK_HOURS.start * HOUR && t < day + WORK_HOURS.end * HOUR;
}

/**
 * Leads created at or before this moment have already used up the response target in working time.
 * Lets SQL keep a plain `created_time <= cutoff` filter.
 */
export function slaCutoff(now: Date = new Date(), minutes = SLA_MINUTES) {
  const off = offsetMs(now);
  const b = now.getTime() + off;
  let need = minutes * 60_000;
  let day = Math.floor(b / DAY) * DAY;
  for (let i = 0; i < 30; i++, day -= DAY) {
    if (!isWorkDay(day)) continue;
    const s = day + WORK_HOURS.start * HOUR;
    const e = Math.min(b, day + WORK_HOURS.end * HOUR);
    if (e <= s) continue;
    if (e - s >= need) return new Date(e - need - off);
    need -= e - s;
  }
  return new Date(now.getTime() - 30 * DAY);
}

/** Past the response target in working time. Only the last `lookbackDays` count: older "New" leads are imported history. */
export function isOverdue(createdTime: Date, lookbackDays = 7, now: Date = new Date()) {
  return now.getTime() - createdTime.getTime() < lookbackDays * DAY && businessMinutes(createdTime, now) > SLA_MINUTES;
}

const DAY_NAMES = ["", "пн", "вт", "ср", "чт", "пт", "сб", "нд"];
const hh = (h: number) => `${Math.floor(h)}:${h % 1 ? "30" : "00"}`;

/** "пн–пт 9:00–19:00" for hints. */
export function workTimeLabel() {
  const d = [...WORK_DAYS].sort();
  const contiguous = d.every((v, i) => i === 0 || v === d[i - 1] + 1);
  const days = contiguous && d.length > 1 ? `${DAY_NAMES[d[0]]}–${DAY_NAMES[d[d.length - 1]]}` : d.map((v) => DAY_NAMES[v]).join(", ");
  return `${days} ${hh(WORK_HOURS.start)}–${hh(WORK_HOURS.end)}`;
}
