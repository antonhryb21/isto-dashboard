import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  numeric,
  boolean,
  jsonb,
  date,
  primaryKey,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["admin", "marketing", "viewer"]);

/** People allowed to sign in. Access is by email allowlist. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: roleEnum("role").notNull().default("viewer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

/** Markets ISTO advertises in. Keywords match campaign / form / sheet names. */
export const regions = pgTable("regions", {
  code: text("code").primaryKey(), // e.g. "dubai", "eu"
  name: text("name").notNull(), // e.g. "Dubai"
  keywords: text("keywords").array().notNull().default([]),
  currency: text("currency").notNull().default("AED"),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** A Google Sheets tab that lead-form leads land in. */
export const leadSources = pgTable(
  "lead_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spreadsheetId: text("spreadsheet_id").notNull(),
    sheetName: text("sheet_name").notNull(),
    regionCode: text("region_code").references(() => regions.code),
    enabled: boolean("enabled").notNull().default(true),
    /** Tab in the same spreadsheet where status changes are appended (optional). */
    historySheetName: text("history_sheet_name"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (t) => [uniqueIndex("lead_sources_sheet_uq").on(t.spreadsheetId, t.sheetName)],
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    metaLeadId: text("meta_lead_id"),
    sourceId: uuid("source_id").references(() => leadSources.id),
    sheetRow: integer("sheet_row"),
    createdTime: timestamp("created_time", { withTimezone: true }).notNull(),
    regionCode: text("region_code"),
    platform: text("platform"), // fb | ig | website | other
    isOrganic: boolean("is_organic").notNull().default(false),
    campaignId: text("campaign_id"),
    campaignName: text("campaign_name"),
    adsetId: text("adset_id"),
    adsetName: text("adset_name"),
    adId: text("ad_id"),
    adName: text("ad_name"),
    formId: text("form_id"),
    formName: text("form_name"),
    fullName: text("full_name"),
    phone: text("phone"),
    email: text("email"),
    city: text("city"),
    answers: jsonb("answers").$type<Record<string, string>>().notNull().default({}),
    status: text("status").notNull().default("new"),
    statusRaw: text("status_raw"),
    statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }),
    owner: text("owner"),
    dealAmount: numeric("deal_amount", { precision: 14, scale: 2 }),
    dealCurrency: text("deal_currency"),
    firstContactAt: timestamp("first_contact_at", { withTimezone: true }),
    sheetComment: text("sheet_comment"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("leads_meta_lead_uq").on(t.metaLeadId),
    index("leads_created_idx").on(t.createdTime),
    index("leads_status_idx").on(t.status),
    index("leads_ad_idx").on(t.adId),
  ],
);

/** Everything that happened to a lead: status moves, comments, owner and amount changes. */
export const leadEvents = pgTable(
  "lead_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // created | status | comment | owner | amount
    fromValue: text("from_value"),
    toValue: text("to_value"),
    text: text("text"),
    author: text("author"), // email, or "sheet" / "meta"
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lead_events_lead_idx").on(t.leadId, t.createdAt)],
);

export const campaigns = pgTable("campaigns", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  name: text("name").notNull(),
  objective: text("objective"),
  status: text("status"),
  regionCode: text("region_code"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per ad with its creative, so the dashboard can show the visual. */
export const ads = pgTable(
  "ads",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    campaignId: text("campaign_id"),
    adsetId: text("adset_id"),
    adsetName: text("adset_name"),
    name: text("name").notNull(),
    status: text("status"),
    createdTime: timestamp("created_time", { withTimezone: true }),
    creativeId: text("creative_id"),
    thumbnailUrl: text("thumbnail_url"),
    imageUrl: text("image_url"),
    videoId: text("video_id"),
    body: text("body"),
    title: text("title"),
    objectType: text("object_type"),
    instagramMediaId: text("instagram_media_id"),
    pagePostId: text("page_post_id"),
    permalink: text("permalink"),
    previewLink: text("preview_link"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ads_campaign_idx").on(t.campaignId), index("ads_igmedia_idx").on(t.instagramMediaId)],
);

/** Daily ad-level metrics from the Marketing API. */
export const adInsightsDaily = pgTable(
  "ad_insights_daily",
  {
    date: date("date").notNull(),
    adId: text("ad_id").notNull(),
    accountId: text("account_id").notNull(),
    campaignId: text("campaign_id"),
    adsetId: text("adset_id"),
    currency: text("currency"),
    spend: numeric("spend", { precision: 14, scale: 2 }).notNull().default("0"),
    impressions: integer("impressions").notNull().default(0),
    reach: integer("reach").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    linkClicks: integer("link_clicks").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.date, t.adId] }), index("ins_campaign_idx").on(t.campaignId, t.date)],
);

/** Organic Instagram and Facebook posts with their latest metrics. */
export const socialPosts = pgTable(
  "social_posts",
  {
    id: text("id").primaryKey(),
    platform: text("platform").notNull(), // ig | fb
    accountId: text("account_id").notNull(),
    contentType: text("content_type").notNull(), // post | reel | carousel | story | video
    caption: text("caption"),
    mediaUrl: text("media_url"),
    thumbnailUrl: text("thumbnail_url"),
    permalink: text("permalink"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    likes: integer("likes"),
    comments: integer("comments"),
    saves: integer("saves"),
    shares: integer("shares"),
    reach: integer("reach"),
    views: integer("views"),
    profileVisits: integer("profile_visits"),
    follows: integer("follows"),
    totalInteractions: integer("total_interactions"),
    boosted: boolean("boosted").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("social_published_idx").on(t.platform, t.publishedAt)],
);

/** Daily snapshot of a post's metrics, so growth over time can be shown. */
export const socialPostSnapshots = pgTable(
  "social_post_snapshots",
  {
    postId: text("post_id").notNull(),
    date: date("date").notNull(),
    metrics: jsonb("metrics").$type<Record<string, number | null>>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.date] })],
);

/** Followers per account per day. */
export const accountSnapshots = pgTable(
  "account_snapshots",
  {
    platform: text("platform").notNull(),
    accountId: text("account_id").notNull(),
    date: date("date").notNull(),
    followers: integer("followers"),
    mediaCount: integer("media_count"),
  },
  (t) => [primaryKey({ columns: [t.platform, t.accountId, t.date] })],
);

export const syncRuns = pgTable("sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ok: boolean("ok"),
  message: text("message"),
});

export type Lead = typeof leads.$inferSelect;
export type LeadEvent = typeof leadEvents.$inferSelect;
export type User = typeof users.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];
