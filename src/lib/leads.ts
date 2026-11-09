import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { leadEvents, leads, type Lead } from "@/db/schema";
import { normalizeStatus, type StatusCode } from "@/lib/statuses";

export type IncomingLead = {
  metaLeadId: string;
  createdTime: Date;
  regionCode: string | null;
  platform: string | null;
  isOrganic: boolean;
  campaignId: string | null;
  campaignName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  adId: string | null;
  adName: string | null;
  formId: string | null;
  formName: string | null;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  answers: Record<string, string>;
  // Only present when the lead comes from a sheet:
  sourceId?: string;
  sheetRow?: number;
  statusRaw?: string | null;
  owner?: string | null;
  sheetComment?: string | null;
};

/**
 * Insert or update a lead. Contact data and ad attribution are refreshed.
 * - "meta":   lead from the Meta webhook/API — never touches status or owner.
 * - "sheet":  live Google Sheets sync — sheet status wins, except within two minutes of a CRM edit.
 * - "import": one-off history import (CSV) — status/owner applied only to leads nobody has
 *             touched in the CRM or the bot yet, so re-importing an old file can't undo work.
 */
export async function upsertLead(input: IncomingLead, author: "sheet" | "meta" | "import"): Promise<"created" | "updated" | "same"> {
  const [existing] = await db.select().from(leads).where(eq(leads.metaLeadId, input.metaLeadId)).limit(1);

  if (!existing) {
    const status = normalizeStatus(input.statusRaw);
    const [row] = await db
      .insert(leads)
      .values({
        ...input,
        status,
        statusRaw: input.statusRaw ?? null,
        owner: input.owner ?? null,
        sheetComment: input.sheetComment ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: leads.id });
    if (row) {
      await db.insert(leadEvents).values({ leadId: row.id, type: "created", toValue: status, author, createdAt: input.createdTime });
    }
    return "created";
  }

  const patch: Partial<Lead> = {};
  const keep = <K extends keyof IncomingLead & keyof Lead>(k: K) => {
    const v = input[k];
    if (v !== undefined && v !== null && v !== "" && v !== existing[k]) (patch as Record<string, unknown>)[k] = v;
  };
  (["fullName", "phone", "email", "city", "campaignId", "campaignName", "adsetId", "adsetName", "adId", "adName", "formId", "formName", "platform", "regionCode"] as const).forEach(keep);
  if (Object.keys(input.answers).length && JSON.stringify(input.answers) !== JSON.stringify(existing.answers)) patch.answers = input.answers;
  if (author === "import") {
    // Merge comments from every tab the lead appears in instead of overwriting.
    const c = input.sheetComment?.trim();
    if (c && !(existing.sheetComment ?? "").includes(c)) patch.sheetComment = [existing.sheetComment, c].filter(Boolean).join("\n");
  } else if (input.sheetComment !== undefined && input.sheetComment !== existing.sheetComment) {
    patch.sheetComment = input.sheetComment;
  }

  if (input.sourceId) {
    if (!existing.sourceId) patch.sourceId = input.sourceId;
    if ((existing.sourceId ?? input.sourceId) === input.sourceId && input.sheetRow !== existing.sheetRow) patch.sheetRow = input.sheetRow;
  }

  const recentCrmEdit = existing.statusUpdatedAt && Date.now() - existing.statusUpdatedAt.getTime() < 120_000;
  const isOwnSource = !existing.sourceId || existing.sourceId === input.sourceId;
  const events: (typeof leadEvents.$inferInsert)[] = [];

  const fromTable = author === "sheet" || author === "import";
  // Import: the same lead often sits in several tabs; never let an old "CREATED" row undo a real status.
  const statusAllowed =
    author === "sheet" ? isOwnSource && !recentCrmEdit : author === "import" ? !existing.statusUpdatedAt && existing.status === "new" : false;

  if (fromTable && statusAllowed && input.statusRaw !== undefined && input.statusRaw !== "") {
    const next = normalizeStatus(input.statusRaw);
    if (next !== existing.status) {
      patch.status = next;
      patch.statusRaw = input.statusRaw ?? null;
      events.push({ leadId: existing.id, type: "status", fromValue: existing.status, toValue: next, author });
      if (!existing.firstContactAt && existing.status === "new" && next !== "new") patch.firstContactAt = new Date();
    }
  }
  if (fromTable && (author === "sheet" ? isOwnSource : !existing.owner) && input.owner && input.owner !== existing.owner) {
    events.push({ leadId: existing.id, type: "owner", fromValue: existing.owner, toValue: input.owner, author });
    patch.owner = input.owner;
  }

  if (!Object.keys(patch).length) return "same";
  patch.updatedAt = new Date();
  await db.update(leads).set(patch).where(eq(leads.id, existing.id));
  if (events.length) await db.insert(leadEvents).values(events);
  return "updated";
}

/** Change a lead from the CRM screen. Returns the old value for the event log. */
export async function setLeadFields(
  leadId: string,
  author: string,
  change: { status?: StatusCode; owner?: string | null; dealAmount?: string | null; dealCurrency?: string | null },
) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw new Error("Lead not found");
  const patch: Partial<Lead> = { updatedAt: new Date() };
  const events: (typeof leadEvents.$inferInsert)[] = [];

  if (change.status && change.status !== lead.status) {
    patch.status = change.status;
    patch.statusUpdatedAt = new Date();
    if (!lead.firstContactAt && lead.status === "new") patch.firstContactAt = new Date();
    events.push({ leadId, type: "status", fromValue: lead.status, toValue: change.status, author });
  }
  if (change.owner !== undefined && (change.owner || null) !== lead.owner) {
    patch.owner = change.owner || null;
    events.push({ leadId, type: "owner", fromValue: lead.owner, toValue: change.owner || null, author });
  }
  if (change.dealAmount !== undefined && (change.dealAmount || null) !== lead.dealAmount) {
    patch.dealAmount = change.dealAmount || null;
    patch.dealCurrency = change.dealCurrency ?? lead.dealCurrency;
    events.push({ leadId, type: "amount", fromValue: lead.dealAmount, toValue: change.dealAmount || null, author });
  }
  await db.update(leads).set(patch).where(eq(leads.id, leadId));
  if (events.length) await db.insert(leadEvents).values(events);
  return { before: lead, events };
}

export async function addComment(leadId: string, author: string, text: string) {
  await db.insert(leadEvents).values({ leadId, type: "comment", text, author });
  await db.update(leads).set({ updatedAt: new Date() }).where(eq(leads.id, leadId));
}

export async function leadByMetaId(metaLeadId: string) {
  const [l] = await db.select().from(leads).where(and(eq(leads.metaLeadId, metaLeadId))).limit(1);
  return l ?? null;
}
