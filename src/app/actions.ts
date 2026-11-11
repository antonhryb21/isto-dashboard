"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { sendLeadStage } from "@/lib/meta/crm-events";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { competitors, leadSources, regions, targets, users, type Role } from "@/db/schema";
import { requireUser } from "@/lib/auth/current-user";
import { addComment, setLeadFields } from "@/lib/leads";
import { subscribePageToLeadgen } from "@/lib/meta/leadgen";
import { writeBackLead, discoverSources } from "@/lib/sheets/sync";
import { STATUS_BY_CODE, type StatusCode } from "@/lib/statuses";
import { ensureSeed, runSync, type SyncKind } from "@/lib/sync";
import { syncCompetitors } from "@/lib/meta/competitors";
import { sendDigest } from "@/lib/digest";
import { aiEnabled, generateInsights, MANUAL_COOLDOWN_MINUTES, recentManualRun } from "@/lib/ai/insights";

export type ActionResult = { ok: boolean; message?: string };

// ---------- CRM ----------

export async function updateLeadAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const user = await requireUser("marketing");
  const id = String(form.get("id"));
  const status = form.get("status") ? (String(form.get("status")) as StatusCode) : undefined;
  if (status && !STATUS_BY_CODE[status]) return { ok: false, message: "Невідомий статус" };
  const ownerRaw = form.get("owner");
  const amountRaw = form.get("dealAmount");
  const owner = ownerRaw === null ? undefined : String(ownerRaw).trim() || null;
  const amount = amountRaw === null ? undefined : String(amountRaw).replace(/\s/g, "").replace(",", ".") || null;
  if (amount && Number.isNaN(Number(amount))) return { ok: false, message: "Сума має бути числом" };
  const nextRaw = form.get("nextContactAt");
  const nextContactAt = nextRaw === null ? undefined : String(nextRaw).trim() || null;
  if (nextContactAt && !/^\d{4}-\d{2}-\d{2}$/.test(nextContactAt)) return { ok: false, message: "Невірна дата наступного контакту" };
  const reasonRaw = form.get("lostReason");
  const lostReason = reasonRaw === null ? undefined : String(reasonRaw).trim().slice(0, 200) || null;

  const { before, events } = await setLeadFields(id, user.email, {
    status,
    owner,
    dealAmount: amount,
    dealCurrency: form.get("dealCurrency") ? String(form.get("dealCurrency")) : undefined,
    nextContactAt,
    lostReason,
  });

  let message: string | undefined;
  const statusChanged = events.some((e) => e.type === "status");
  const ownerChanged = events.some((e) => e.type === "owner");
  if ((statusChanged || ownerChanged) && before.sourceId && process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) {
    try {
      const res = await writeBackLead(
        before,
        { status: statusChanged ? status : undefined, owner: ownerChanged ? owner : undefined, previousStatus: before.status },
        user.email,
      );
      if (!res.ok) message = `Збережено в CRM, але не в таблиці: ${res.message}`;
    } catch (e) {
      message = `Збережено в CRM, але не в таблиці: ${e instanceof Error ? e.message : e}`;
    }
  }
  if (statusChanged && status) after(() => sendLeadStage(before.metaLeadId, status));
  revalidatePath("/crm");
  revalidatePath(`/crm/${id}`);
  return { ok: true, message };
}

export async function quickStatusAction(id: string, status: StatusCode): Promise<ActionResult> {
  const form = new FormData();
  form.set("id", id);
  form.set("status", status);
  return updateLeadAction(null, form);
}

export async function quickOwnerAction(id: string, owner: string): Promise<ActionResult> {
  const form = new FormData();
  form.set("id", id);
  form.set("owner", owner);
  return updateLeadAction(null, form);
}

export async function addCommentAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const user = await requireUser("marketing");
  const id = String(form.get("id"));
  const text = String(form.get("text") ?? "").trim();
  if (!text) return { ok: false, message: "Коментар порожній" };
  await addComment(id, user.email, text.slice(0, 4000));
  revalidatePath(`/crm/${id}`);
  return { ok: true };
}

// ---------- Sync ----------

export async function syncNowAction(kind: SyncKind = "quick"): Promise<ActionResult> {
  await requireUser(kind === "quick" ? "viewer" : "admin");
  const report = await runSync(kind, { months: 12 });
  revalidatePath("/", "layout");
  if ("skipped" in report) return { ok: true, message: "Оновлення вже триває" };
  const errors = Object.entries(report)
    .filter(([, v]) => typeof v === "object" && v !== null && "error" in v)
    .map(([k, v]) => `${k}: ${(v as { error: string }).error}`);
  return errors.length ? { ok: false, message: errors.join(" · ") } : { ok: true, message: "Дані оновлено" };
}

export async function subscribeLeadgenAction(): Promise<ActionResult> {
  await requireUser("admin");
  try {
    await subscribePageToLeadgen();
    return { ok: true, message: "Сторінку підписано на нові ліди" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// ---------- Admin ----------

export async function saveUserAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireUser("admin");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const role = String(form.get("role") ?? "viewer") as Role;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: "Некоректний email" };
  if (!["admin", "marketing", "viewer"].includes(role)) return { ok: false, message: "Невідома роль" };
  await db.insert(users).values({ email, role }).onConflictDoUpdate({ target: users.email, set: { role } });
  revalidatePath("/admin");
  return { ok: true };
}

export async function removeUserAction(email: string): Promise<ActionResult> {
  const me = await requireUser("admin");
  if (email === me.email) return { ok: false, message: "Не можна видалити себе" };
  await db.delete(users).where(eq(users.email, email));
  revalidatePath("/admin");
  return { ok: true };
}

export async function saveRegionAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireUser("admin");
  const name = String(form.get("name") ?? "").trim();
  const code = (String(form.get("code") ?? "").trim() || name).toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const keywords = String(form.get("keywords") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const currency = String(form.get("currency") ?? "AED").trim().toUpperCase() || "AED";
  if (!name || !code) return { ok: false, message: "Вкажіть назву" };
  await db
    .insert(regions)
    .values({ code, name, keywords, currency, sortOrder: 10 })
    .onConflictDoUpdate({ target: regions.code, set: { name, keywords, currency } });
  revalidatePath("/admin");
  return { ok: true };
}

/** Add a spreadsheet: every lead tab in it becomes a source for the given region. */
/** Who receives new leads of a region automatically. */
export async function setRegionOwnerAction(code: string, owner: string): Promise<ActionResult> {
  await requireUser("admin");
  await db.update(regions).set({ defaultOwner: owner.trim().slice(0, 80) || null }).where(eq(regions.code, code));
  revalidatePath("/admin");
  return { ok: true };
}

export async function addSpreadsheetAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireUser("admin");
  const raw = String(form.get("spreadsheet") ?? "").trim();
  const id = raw.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? raw;
  const region = String(form.get("region") ?? "") || null;
  const history = String(form.get("history") ?? "").trim() || null;
  if (!/^[a-zA-Z0-9_-]{20,}$/.test(id)) return { ok: false, message: "Вставте посилання на Google Таблицю" };
  try {
    await discoverSources(id, region, history);
  } catch (e) {
    return {
      ok: false,
      message: `Немає доступу до таблиці. Відкрийте її для сервісного акаунта. (${e instanceof Error ? e.message.slice(0, 120) : e})`,
    };
  }
  revalidatePath("/admin");
  return { ok: true, message: "Таблицю додано" };
}

export async function toggleSourceAction(id: string, enabled: boolean): Promise<ActionResult> {
  await requireUser("admin");
  await db.update(leadSources).set({ enabled }).where(eq(leadSources.id, id));
  revalidatePath("/admin");
  return { ok: true };
}

export async function setSourceRegionAction(id: string, region: string): Promise<ActionResult> {
  await requireUser("admin");
  await db.update(leadSources).set({ regionCode: region || null }).where(eq(leadSources.id, id));
  revalidatePath("/admin");
  return { ok: true };
}

// ---------- History import (CSV exported from Google Sheets) ----------

export type ImportResult = ActionResult & { created?: number; updated?: number; skipped?: number };

/**
 * One batch of CSV rows. The browser parses the file and sends ~250 rows per call,
 * which keeps every request well under Vercel's body size limit.
 */
export async function importRowsAction(input: {
  header: string[];
  rows: string[][];
  regionCode: string | null;
  fileName: string;
}): Promise<ImportResult> {
  await requireUser("admin");
  const { mapColumns, isLeadTable, rowToLead } = await import("@/lib/lead-rows");
  const { upsertLead } = await import("@/lib/leads");
  const { listRegions } = await import("@/lib/regions");
  const map = mapColumns(input.header);
  if (!isLeadTable(map)) {
    return { ok: false, message: "У файлі немає колонок id, phone або email — це не схоже на список лідів." };
  }
  const regions = await listRegions();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of input.rows.slice(0, 1000)) {
    const lead = rowToLead(map, row, {
      regions,
      regionCode: input.regionCode,
      tabName: input.fileName,
      fallbackKey: `csv:${input.fileName}`,
    });
    if (!lead) {
      skipped++;
      continue;
    }
    const r = await upsertLead(lead, "import");
    if (r === "created") created++;
    else if (r === "updated") updated++;
    else skipped++;
  }
  revalidatePath("/crm");
  return { ok: true, created, updated, skipped };
}

// ---------- Competitors ----------

export async function syncCompetitorsAction(): Promise<ActionResult> {
  await requireUser("marketing");
  await ensureSeed();
  const report = await syncCompetitors(2);
  revalidatePath("/competitors");
  const errors = Object.entries(report).filter(([, v]) => typeof v === "string");
  return errors.length
    ? { ok: false, message: errors.map(([k, v]) => `@${k}: ${String(v).replace(/^error: /, "")}`).join(" · ") }
    : { ok: true, message: "Дані конкурентів оновлено" };
}

/** Accepts "@name", "name" or an instagram.com profile link. */
function igUsername(raw: string) {
  const s = raw.trim();
  const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  return (m ? m[1] : s.replace(/^@/, "")).toLowerCase();
}

export async function saveCompetitorAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireUser("admin");
  const username = igUsername(String(form.get("username") ?? ""));
  if (!/^[a-z0-9._]{1,30}$/.test(username)) return { ok: false, message: "Вкажіть нікнейм або посилання на Instagram" };
  const name = String(form.get("name") ?? "").trim() || username;
  const adLibraryPageIds = String(form.get("pages") ?? "")
    .split(/[\s,]+/)
    .map((x) => x.match(/\d{6,}/)?.[0])
    .filter(Boolean) as string[];
  await db
    .insert(competitors)
    .values({ username, name, adLibraryPageIds, active: true })
    .onConflictDoUpdate({ target: competitors.username, set: { name, adLibraryPageIds, active: true } });
  await syncCompetitors(1).catch(() => null);
  revalidatePath("/competitors");
  revalidatePath("/admin");
  return { ok: true, message: `@${username} додано` };
}

export async function removeCompetitorAction(username: string): Promise<ActionResult> {
  await requireUser("admin");
  // Kept in the database (history stays), just hidden and no longer synced.
  await db.update(competitors).set({ active: false }).where(eq(competitors.username, username));
  revalidatePath("/competitors");
  revalidatePath("/admin");
  return { ok: true };
}

// ---------- Monthly plan ----------

export async function saveTargetAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireUser("admin");
  const month = String(form.get("month") ?? "");
  const regionCode = String(form.get("region") ?? "");
  if (!/^\d{4}-\d{2}$/.test(month) || !regionCode) return { ok: false, message: "Оберіть місяць і регіон" };
  const n = (k: string) => {
    const v = String(form.get(k) ?? "").replace(/\s/g, "").replace(",", ".");
    return v ? Number(v) : null;
  };
  const values = {
    month: `${month}-01`,
    regionCode,
    budget: n("budget") === null ? null : String(n("budget")),
    leads: n("leads"),
    qualified: n("qualified"),
    deals: n("deals"),
    updatedAt: new Date(),
  };
  if ([values.budget, values.leads, values.qualified, values.deals].every((v) => v === null)) return { ok: false, message: "Вкажіть хоча б одну ціль" };
  await db.insert(targets).values(values).onConflictDoUpdate({ target: [targets.month, targets.regionCode], set: values });
  revalidatePath("/");
  revalidatePath("/admin");
  return { ok: true, message: "План збережено" };
}

export async function deleteTargetAction(month: string, regionCode: string): Promise<ActionResult> {
  await requireUser("admin");
  await db.delete(targets).where(and(eq(targets.month, month), eq(targets.regionCode, regionCode)));
  revalidatePath("/");
  revalidatePath("/admin");
  return { ok: true };
}

// ---------- Telegram ----------

export async function sendDigestAction(): Promise<ActionResult> {
  await requireUser("admin");
  try {
    await sendDigest();
    return { ok: true, message: "Звіт надіслано в Telegram" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// ---------- AI insights ----------

export async function generateInsightsAction(): Promise<ActionResult> {
  const user = await requireUser("marketing");
  if (!aiEnabled()) return { ok: false, message: "Не задано ANTHROPIC_API_KEY у Vercel" };
  const recent = await recentManualRun();
  if (recent) {
    const left = MANUAL_COOLDOWN_MINUTES - Math.floor((Date.now() - recent.createdAt.getTime()) / 60_000);
    return { ok: false, message: `Аналіз уже свіжий. Новий можна запустити через ${left} хв.` };
  }
  try {
    await generateInsights("manual", user.email);
    revalidatePath("/insights");
    revalidatePath("/");
    return { ok: true, message: "Готово" };
  } catch (e) {
    revalidatePath("/insights");
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
