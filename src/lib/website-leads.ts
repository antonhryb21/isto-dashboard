import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { leadEvents, leads, regions } from "@/db/schema";
import { websiteLeadKey, type WebsiteLeadInput } from "@/lib/website-lead";
import { wasDeleted } from "@/lib/leads";

/**
 * Save a website form lead. Marked `source: "website"`, `platform: "website"`, organic,
 * so it shows as "Сайт" and is not counted as a result of ad spend.
 * Sending the same submission again changes nothing.
 */
export async function saveWebsiteLead(input: WebsiteLeadInput): Promise<{ id: string | null; created: boolean; deleted?: true }> {
  const key = websiteLeadKey(input);
  // An admin deleted this submission from the CRM: a resend does not bring it back.
  if (await wasDeleted(key)) return { id: null, created: false, deleted: true };
  const [existing] = await db.select({ id: leads.id }).from(leads).where(eq(leads.metaLeadId, key)).limit(1);
  if (existing) return { id: existing.id, created: false };

  let owner: string | null = null;
  if (input.regionCode) {
    const [r] = await db.select({ owner: regions.defaultOwner }).from(regions).where(eq(regions.code, input.regionCode)).limit(1);
    owner = r?.owner ?? null;
  }

  const [row] = await db
    .insert(leads)
    .values({
      metaLeadId: key,
      source: "website",
      platform: "website",
      isOrganic: true,
      createdTime: input.createdTime,
      regionCode: input.regionCode,
      formId: input.formId,
      formName: input.formName,
      campaignName: input.campaignName,
      fullName: input.fullName,
      phone: input.phone,
      email: input.email,
      city: input.city,
      answers: input.answers,
      owner,
    })
    .onConflictDoNothing()
    .returning({ id: leads.id });

  if (!row) {
    // Two copies of the same submission arrived at once; the other one saved it.
    const [again] = await db.select({ id: leads.id }).from(leads).where(eq(leads.metaLeadId, key)).limit(1);
    return { id: again.id, created: false };
  }

  const events: (typeof leadEvents.$inferInsert)[] = [
    { leadId: row.id, type: "created", toValue: "new", author: "website", createdAt: input.createdTime },
  ];
  if (owner) events.push({ leadId: row.id, type: "owner", toValue: owner, author: "auto" });
  await db.insert(leadEvents).values(events);
  return { id: row.id, created: true };
}
