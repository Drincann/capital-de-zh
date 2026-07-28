import { sql } from "drizzle-orm";
import {
  index,
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

export const analyticsEvents = sqliteTable(
  "analytics_events",
  {
    id: text("id").primaryKey(),
    visitorKey: text("visitor_key").notNull(),
    occurredAt: text("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    path: text("path").notNull(),
    queryString: text("query_string").notNull().default(""),
    pageTitle: text("page_title").notNull().default(""),
    referrer: text("referrer").notNull().default(""),
    ipAddress: text("ip_address").notNull().default(""),
    userAgent: text("user_agent").notNull().default(""),
    acceptLanguage: text("accept_language").notNull().default(""),
    clientLanguage: text("client_language").notNull().default(""),
    clientTimezone: text("client_timezone").notNull().default(""),
    screenWidth: integer("screen_width"),
    screenHeight: integer("screen_height"),
    viewportWidth: integer("viewport_width"),
    viewportHeight: integer("viewport_height"),
    country: text("country").notNull().default(""),
    region: text("region").notNull().default(""),
    city: text("city").notNull().default(""),
    postalCode: text("postal_code").notNull().default(""),
    edgeTimezone: text("edge_timezone").notNull().default(""),
    latitude: text("latitude").notNull().default(""),
    longitude: text("longitude").notNull().default(""),
    asn: integer("asn"),
    colo: text("colo").notNull().default(""),
    httpProtocol: text("http_protocol").notNull().default(""),
    tlsVersion: text("tls_version").notNull().default(""),
  },
  (table) => [
    index("analytics_events_occurred_at_idx").on(table.occurredAt),
    index("analytics_events_visitor_key_idx").on(table.visitorKey),
  ]
);
