import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const analyticsVisitors = sqliteTable("analytics_visitors", {
  visitorId: text("visitor_id").primaryKey(),
  firstSeenAt: text("first_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const analyticsDailyVisitors = sqliteTable(
  "analytics_daily_visitors",
  {
    day: text("day").notNull(),
    visitorId: text("visitor_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.day, table.visitorId] })],
);

export const analyticsDailyMetrics = sqliteTable("analytics_daily_metrics", {
  day: text("day").primaryKey(),
  pageViews: integer("page_views").notNull().default(0),
  uniqueVisitors: integer("unique_visitors").notNull().default(0),
});

export const analyticsFingerprintAliases = sqliteTable(
  "analytics_fingerprint_aliases",
  {
    fingerprintHash: text("fingerprint_hash").primaryKey(),
    visitorId: text("visitor_id").notNull(),
    firstSeenAt: text("first_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
);

export const analyticsRateLimits = sqliteTable(
  "analytics_rate_limits",
  {
    bucket: text("bucket").notNull(),
    limiterKey: text("limiter_key").notNull(),
    requestCount: integer("request_count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.bucket, table.limiterKey] })],
);

export const readerNotes = sqliteTable(
  "reader_notes",
  {
    id: text("id").primaryKey(),
    sectionId: text("section_id").notNull(),
    versionId: text("version_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    quote: text("quote").notNull(),
    prefix: text("prefix").notNull().default(""),
    suffix: text("suffix").notNull().default(""),
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    body: text("body").notNull().default(""),
    color: text("color").notNull().default("amber"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("reader_notes_section_idx").on(table.sectionId)],
);
