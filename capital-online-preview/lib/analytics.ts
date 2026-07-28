import { getD1 } from "@/db";
import { analyticsSecret } from "@/lib/runtime-env";

const COOKIE_NAME = "__Host-capital_webid";
const COOKIE_PATTERN = /^[a-f0-9]{64}$/;
const FINGERPRINT_PATTERN = /^[A-Za-z0-9_-]{8,160}$/;
const MAX_REQUEST_BODY_BYTES = 4096;

export type AnalyticsDay = {
  day: string;
  pageViews: number;
  uniqueVisitors: number;
};

export type AnalyticsSummary = {
  totalPageViews: number;
  totalVisitors: number;
  today: AnalyticsDay;
  days: AnalyticsDay[];
};

function cookieValue(request: Request, name: string): string {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]+)`, "i"),
  );
  return match?.[1] || "";
}

async function hmac(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function shanghaiDay(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function hourBucket(date = new Date()): string {
  return date.toISOString().slice(0, 13);
}

async function consumeRateLimit(
  db: D1Database,
  bucket: string,
  limiterKey: string,
  limit: number,
): Promise<boolean> {
  await db
    .prepare(
      `INSERT INTO analytics_rate_limits (bucket, limiter_key, request_count)
       VALUES (?, ?, 1)
       ON CONFLICT(bucket, limiter_key)
       DO UPDATE SET request_count = request_count + 1`,
    )
    .bind(bucket, limiterKey)
    .run();
  const row = await db
    .prepare(
      `SELECT request_count AS requestCount
       FROM analytics_rate_limits
       WHERE bucket = ? AND limiter_key = ?`,
    )
    .bind(bucket, limiterKey)
    .first<{ requestCount: number }>();
  return Number(row?.requestCount || 0) <= limit;
}

function sameOriginRequest(request: Request): boolean {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== requestUrl.origin) return false;
    } catch {
      return false;
    }
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

export type TrackResult = {
  isNewCookie: boolean;
  visitorId: string;
};

export async function trackPageView(request: Request): Promise<TrackResult> {
  if (!sameOriginRequest(request)) {
    throw new AnalyticsRequestError("Cross-origin analytics request.", 403);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BODY_BYTES) {
    throw new AnalyticsRequestError("Request body is too large.", 413);
  }

  const payload = (await request.json().catch(() => ({}))) as {
    fingerprintHint?: unknown;
  };
  const fingerprintHint =
    typeof payload.fingerprintHint === "string" &&
    FINGERPRINT_PATTERN.test(payload.fingerprintHint)
      ? payload.fingerprintHint
      : "";

  const url = new URL(request.url);
  const secret = analyticsSecret(url.hostname);
  const db = getD1();
  const storedCookie = cookieValue(request, COOKIE_NAME);
  const validCookie = COOKIE_PATTERN.test(storedCookie) ? storedCookie : "";
  const fingerprintHash = fingerprintHint
    ? await hmac(`fingerprint:${fingerprintHint}`, secret)
    : "";

  let visitorId = validCookie;
  if (!visitorId && fingerprintHash) {
    const alias = await db
      .prepare(
        `SELECT visitor_id AS visitorId
         FROM analytics_fingerprint_aliases
         WHERE fingerprint_hash = ?
           AND last_seen_at >= datetime('now', '-90 days')`,
      )
      .bind(fingerprintHash)
      .first<{ visitorId: string }>();
    if (alias?.visitorId && COOKIE_PATTERN.test(alias.visitorId)) {
      visitorId = alias.visitorId;
    }
  }
  if (!visitorId) {
    visitorId = await hmac(`visitor:${crypto.randomUUID()}`, secret);
  }

  const edgeIp = request.headers.get("cf-connecting-ip") || "unknown";
  const [visitorLimiter, edgeLimiter] = await Promise.all([
    hmac(`visitor-rate:${visitorId}`, secret),
    hmac(`edge-rate:${edgeIp}`, secret),
  ]);
  const bucket = hourBucket();
  const [visitorAllowed, edgeAllowed] = await Promise.all([
    consumeRateLimit(db, bucket, visitorLimiter, 120),
    consumeRateLimit(db, bucket, edgeLimiter, 600),
  ]);
  if (!visitorAllowed || !edgeAllowed) {
    throw new AnalyticsRequestError("Too many analytics requests.", 429);
  }

  await db
    .prepare(
      `INSERT INTO analytics_visitors (visitor_id)
       VALUES (?)
       ON CONFLICT(visitor_id)
       DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP`,
    )
    .bind(visitorId)
    .run();

  if (fingerprintHash) {
    await db
      .prepare(
        `INSERT INTO analytics_fingerprint_aliases
           (fingerprint_hash, visitor_id)
         VALUES (?, ?)
         ON CONFLICT(fingerprint_hash)
         DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP`,
      )
      .bind(fingerprintHash, visitorId)
      .run();
  }

  const day = shanghaiDay();
  const dailyVisit = await db
    .prepare(
      `INSERT OR IGNORE INTO analytics_daily_visitors (day, visitor_id)
       VALUES (?, ?)`,
    )
    .bind(day, visitorId)
    .run();
  const uniqueIncrement = Number(dailyVisit.meta?.changes || 0);

  await db
    .prepare(
      `INSERT INTO analytics_daily_metrics (day, page_views, unique_visitors)
       VALUES (?, 1, ?)
       ON CONFLICT(day)
       DO UPDATE SET
         page_views = page_views + 1,
         unique_visitors = unique_visitors + excluded.unique_visitors`,
    )
    .bind(day, uniqueIncrement)
    .run();

  if (Math.random() < 0.02) {
    await db.batch([
      db.prepare(
        `DELETE FROM analytics_rate_limits
         WHERE bucket < strftime('%Y-%m-%dT%H', 'now', '-3 hours')`,
      ),
      db.prepare(
        `DELETE FROM analytics_fingerprint_aliases
         WHERE last_seen_at < datetime('now', '-90 days')`,
      ),
    ]);
  }

  return {
    isNewCookie: !validCookie,
    visitorId,
  };
}

export function visitorCookie(visitorId: string): string {
  return `${COOKIE_NAME}=${visitorId}; Max-Age=31536000; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

export async function analyticsSummary(limit = 365): Promise<AnalyticsSummary> {
  const db = getD1();
  const [daysResult, totals, visitors] = await Promise.all([
    db
      .prepare(
        `SELECT day, page_views AS pageViews,
                unique_visitors AS uniqueVisitors
         FROM analytics_daily_metrics
         ORDER BY day DESC
         LIMIT ?`,
      )
      .bind(limit)
      .all<AnalyticsDay>(),
    db
      .prepare(
        `SELECT COALESCE(SUM(page_views), 0) AS totalPageViews
         FROM analytics_daily_metrics`,
      )
      .first<{ totalPageViews: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS totalVisitors
         FROM analytics_visitors`,
      )
      .first<{ totalVisitors: number }>(),
  ]);
  const days = [...(daysResult.results || [])]
    .map((row) => ({
      day: String(row.day),
      pageViews: Number(row.pageViews || 0),
      uniqueVisitors: Number(row.uniqueVisitors || 0),
    }))
    .reverse();
  const todayDay = shanghaiDay();
  const today =
    days.find((row) => row.day === todayDay) || {
      day: todayDay,
      pageViews: 0,
      uniqueVisitors: 0,
    };

  return {
    totalPageViews: Number(totals?.totalPageViews || 0),
    totalVisitors: Number(visitors?.totalVisitors || 0),
    today,
    days,
  };
}

export class AnalyticsRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
