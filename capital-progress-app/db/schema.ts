import { sql } from "drizzle-orm";
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const analyticsVisitors = sqliteTable("analytics_visitors", {
  visitorKey: text("visitor_key").primaryKey(),
  firstSeenAt: text("first_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const analyticsDailyVisitors = sqliteTable(
  "analytics_daily_visitors",
  {
    day: text("day").notNull(),
    visitorKey: text("visitor_key").notNull(),
  },
  (table) => [primaryKey({ columns: [table.day, table.visitorKey] })]
);

export const dailyMetrics = sqliteTable("daily_metrics", {
  day: text("day").primaryKey(),
  views: integer("views").notNull().default(0),
  uniqueVisitors: integer("unique_visitors").notNull().default(0),
});

export const siteMetrics = sqliteTable("site_metrics", {
  id: integer("id").primaryKey(),
  totalViews: integer("total_views").notNull().default(0),
  totalVisitors: integer("total_visitors").notNull().default(0),
});
