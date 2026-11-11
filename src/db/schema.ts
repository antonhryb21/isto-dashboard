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
  /** Who gets new Meta leads of this region when nobody is assigned yet. */
  defaultOwner: text("default_owner"),
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
    /** Where the record came from: "meta" (lead form), "manual" (added by hand in the CRM). */
    source: text("source").notNull().default("meta"),
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
    /** Day the lead should be contacted again (follow-up reminder). */
    nextContactAt: date("next_contact_at"),
    /** Why the lead was lost or is not relevant. */
    lostReason: text("lost_reason"),
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
    // Engagement with the ad itself (from the insights `actions` array).
    pageEngagement: integer("page_engagement").notNull().default(0),
    postReactions: integer("post_reactions").notNull().default(0),
    postComments: integer("post_comments").notNull().default(0),
    postSaves: integer("post_saves").notNull().default(0),
    postShares: integer("post_shares").notNull().default(0),
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
    newFollowers: integer("new_followers"), // gained that day (Instagram insights `follower_count`)
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

/** Instagram accounts tracked on the Competitors page (ISTO itself is one of them, `isOwn`). */
export const competitors = pgTable("competitors", {
  username: text("username").primaryKey(),
  name: text("name").notNull(),
  isOwn: boolean("is_own").notNull().default(false),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(100),
  adLibraryPageIds: jsonb("ad_library_page_ids").$type<string[]>().notNull().default([]),
  igId: text("ig_id"),
  displayName: text("display_name"),
  biography: text("biography"),
  website: text("website"),
  profilePictureUrl: text("profile_picture_url"),
  followers: integer("followers"),
  mediaCount: integer("media_count"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastError: text("last_error"),
});

export const competitorSnapshots = pgTable(
  "competitor_snapshots",
  {
    username: text("username").notNull(),
    date: date("date").notNull(),
    followers: integer("followers"),
    mediaCount: integer("media_count"),
  },
  (t) => [primaryKey({ columns: [t.username, t.date] })],
);

/** Public posts of tracked accounts (Instagram Business Discovery: likes and comments only). */
export const competitorPosts = pgTable(
  "competitor_posts",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    contentType: text("content_type").notNull(), // post | reel | carousel | video
    caption: text("caption"),
    mediaUrl: text("media_url"),
    thumbnailUrl: text("thumbnail_url"),
    permalink: text("permalink"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    likes: integer("likes"), // null when the account hides like counts
    comments: integer("comments"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("competitor_posts_user_idx").on(t.username, t.publishedAt)],
);

/** Monthly plan per region (budget in the region's currency). Shown as pacing on the Overview. */
export const targets = pgTable(
  "targets",
  {
    month: date("month").notNull(), // first day of the month
    regionCode: text("region_code").notNull(),
    budget: numeric("budget", { precision: 14, scale: 2 }),
    leads: integer("leads"),
    qualified: integer("qualified"),
    deals: integer("deals"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.month, t.regionCode] })],
);

/** AI insights runs: what Claude concluded from the aggregated numbers (no lead personal data is sent). */
export const aiInsights = pgTable(
  "ai_insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    trigger: text("trigger").notNull(), // cron | manual
    requestedBy: text("requested_by"),
    model: text("model").notNull(),
    periodFrom: date("period_from").notNull(),
    periodTo: date("period_to").notNull(),
    health: integer("health"), // 0–100
    summary: text("summary"),
    insights: jsonb("insights").$type<AiInsight[]>().notNull().default([]),
    snapshot: jsonb("snapshot"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    error: text("error"),
  },
  (t) => [index("ai_insights_created_idx").on(t.createdAt)],
);

export type AiInsight = {
  severity: "critical" | "warning" | "info" | "good";
  category: string;
  title: string;
  evidence: string[];
  action: string;
  expectedEffect?: string;
  confidence: "high" | "medium" | "low";
};
