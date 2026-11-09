import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { leadSources, leads, type Lead } from "@/db/schema";
import { NON_LEAD_TABS } from "@/lib/config";
import { listRegions } from "@/lib/regions";
import { upsertLead } from "@/lib/leads";
import { isLeadTable, mapColumns, rowToLead, strip } from "@/lib/lead-rows";
import { STATUS_BY_CODE, type StatusCode } from "@/lib/statuses";
import { appendRow, listTabs, readTab, writeCells } from "./client";

// ---------- Import (sheet → database) ----------

/** Make sure every lead tab of the configured spreadsheets has a lead_sources row. */
export async function discoverSources(spreadsheetId: string, regionCode: string | null, historySheetName: string | null) {
  const tabs = await listTabs(spreadsheetId);
  for (const tab of tabs) {
    const lower = tab.toLowerCase();
    if (NON_LEAD_TABS.some((n) => lower.startsWith(n))) continue;
    if (historySheetName && tab === historySheetName) continue;
    await db
      .insert(leadSources)
      .values({ spreadsheetId, sheetName: tab, regionCode, historySheetName })
      .onConflictDoNothing();
  }
}

export async function importSource(source: typeof leadSources.$inferSelect) {
  const allRegions = await listRegions();
  const rows = await readTab(source.spreadsheetId, source.sheetName);
  if (rows.length < 2) return { created: 0, updated: 0, skipped: true };
  const map = mapColumns(rows[0]);
  // A tab without an id or a phone/email column isn't a lead list (e.g. a pivot).
  if (!isLeadTable(map)) {
    return { created: 0, updated: 0, skipped: true };
  }

  let created = 0;
  let updated = 0;
  for (let r = 1; r < rows.length; r++) {
    const incoming = rowToLead(map, rows[r], {
      regions: allRegions,
      regionCode: source.regionCode,
      tabName: source.sheetName,
      fallbackKey: `${source.spreadsheetId}:${source.sheetName}`,
    });
    if (!incoming) continue;
    incoming.sourceId = source.id;
    incoming.sheetRow = r + 1;
    const res = await upsertLead(incoming, "sheet");
    if (res === "created") created++;
    if (res === "updated") updated++;
  }
  await db.update(leadSources).set({ lastSyncedAt: new Date(), lastError: null }).where(eq(leadSources.id, source.id));
  return { created, updated, skipped: false };
}

export async function importAllSources() {
  const sources = await db.select().from(leadSources).where(eq(leadSources.enabled, true));
  const result: Record<string, unknown> = {};
  for (const s of sources) {
    try {
      result[`${s.sheetName}`] = await importSource(s);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.update(leadSources).set({ lastError: msg.slice(0, 500) }).where(eq(leadSources.id, s.id));
      result[`${s.sheetName}`] = { error: msg };
    }
  }
  return result;
}

// ---------- Write-back (CRM → sheet) ----------

/**
 * Write a CRM change to the lead's row. The row is looked up by lead id at write time,
 * because people sort and insert rows in the sheet.
 */
export async function writeBackLead(
  lead: Lead,
  change: { status?: StatusCode; owner?: string | null; previousStatus?: string },
  author: string,
): Promise<{ ok: boolean; message?: string }> {
  if (!lead.sourceId) return { ok: false, message: "Лід не прив'язаний до таблиці" };
  const [source] = await db.select().from(leadSources).where(eq(leadSources.id, lead.sourceId)).limit(1);
  if (!source) return { ok: false, message: "Джерело ліда не знайдено" };

  const rows = await readTab(source.spreadsheetId, source.sheetName);
  const map = mapColumns(rows[0] ?? []);
  const idCol = map.fields.id;
  let rowNumber: number | null = null;
  if (idCol !== undefined && lead.metaLeadId && !lead.metaLeadId.startsWith("sheet:")) {
    const i = rows.findIndex((r, idx) => idx > 0 && strip(r[idCol]) === lead.metaLeadId);
    if (i > 0) rowNumber = i + 1;
  }
  if (!rowNumber && lead.sheetRow && rows[lead.sheetRow - 1]) rowNumber = lead.sheetRow;
  if (!rowNumber) return { ok: false, message: "Рядок ліда в таблиці не знайдено" };

  const now = new Date();
  const stamp = formatStamp(now);
  const cells: { row: number; col: number; value: string }[] = [];
  if (change.status && map.fields.status !== undefined) {
    cells.push({ row: rowNumber, col: map.fields.status, value: STATUS_BY_CODE[change.status].label });
    const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
    const at = header.indexOf("status_updated_at");
    const by = header.indexOf("status_updated_by");
    if (at >= 0) cells.push({ row: rowNumber, col: at, value: stamp });
    if (by >= 0) cells.push({ row: rowNumber, col: by, value: author });
  }
  if (change.owner !== undefined && map.fields.owner !== undefined) {
    cells.push({ row: rowNumber, col: map.fields.owner, value: change.owner ?? "" });
  }
  await writeCells(source.spreadsheetId, source.sheetName, cells);

  if (change.status && source.historySheetName) {
    await appendRow(source.spreadsheetId, source.historySheetName, [
      stamp,
      author,
      change.previousStatus ? (STATUS_BY_CODE[change.previousStatus as StatusCode]?.label ?? change.previousStatus) : "",
      STATUS_BY_CODE[change.status].label,
      source.spreadsheetId,
      source.sheetName,
      String(rowNumber),
      "",
    ]);
  }
  await db.update(leads).set({ sheetRow: rowNumber }).where(eq(leads.id, lead.id));
  return { ok: true };
}

/** "dd/MM/yyyy HH:mm:ss" in Kyiv time, matching the existing history tab. */
function formatStamp(d: Date) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}:${g("second")}`;
}
