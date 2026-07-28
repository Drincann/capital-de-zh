import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const sync = spawnSync(
  process.execPath,
  [path.join(root, "scripts", "sync-progress.mjs")],
  { cwd: root, encoding: "utf8" }
);
if (sync.status !== 0) {
  process.stderr.write(sync.stderr || sync.stdout);
  process.exit(sync.status || 1);
}

await rm(path.join(root, "dist"), { recursive: true, force: true });
await mkdir(path.join(root, "dist", "server"), { recursive: true });
await mkdir(path.join(root, "dist", "assets"), { recursive: true });
await mkdir(path.join(root, "dist", ".openai"), { recursive: true });
await cp(
  path.join(root, "public", "index.html"),
  path.join(root, "dist", "assets", "index.html")
);
await cp(
  path.join(root, ".openai", "hosting.json"),
  path.join(root, "dist", ".openai", "hosting.json")
);

const [html, progressText] = await Promise.all([
  readFile(path.join(root, "public", "index.html"), "utf8"),
  readFile(path.join(root, "data", "progress.json"), "utf8"),
]);
const workerSource = `
const pageHtml = ${JSON.stringify(html)};
const progressState = ${progressText.trim()};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function visitorKey(request) {
  const stored = request.headers
    .get("cookie")
    ?.match(/(?:^|;\\s*)capital_reader_visitor=([A-Za-z0-9-]{20,80})/)
    ?.[1];
  return {
    value: stored || crypto.randomUUID(),
    isNewCookie: !stored,
  };
}

async function readAnalytics(db) {
  const totals = await db
    .prepare(
      "SELECT total_views AS totalViews, total_visitors AS totalVisitors FROM site_metrics WHERE id = 1"
    )
    .first();
  const daily = await db
    .prepare(
      "SELECT day, views, unique_visitors AS uniqueVisitors FROM daily_metrics ORDER BY day DESC LIMIT 30"
    )
    .all();
  return {
    totalViews: Number(totals?.totalViews || 0),
    totalVisitors: Number(totals?.totalVisitors || 0),
    daily: daily.results || [],
  };
}

async function recordVisit(db, request) {
  const visitor = visitorKey(request);
  const day = new Date().toISOString().slice(0, 10);
  const body = await request.json().catch(() => ({}));
  const edge = request.cf || {};
  const firstVisit = await db
    .prepare(
      "INSERT OR IGNORE INTO analytics_visitors (visitor_key) VALUES (?)"
    )
    .bind(visitor.value)
    .run();
  const firstVisitToday = await db
    .prepare(
      "INSERT OR IGNORE INTO analytics_daily_visitors (day, visitor_key) VALUES (?, ?)"
    )
    .bind(day, visitor.value)
    .run();
  const newVisitor = Number(firstVisit.meta?.changes || 0);
  const newVisitorToday = Number(firstVisitToday.meta?.changes || 0);
  await db.batch([
    db
      .prepare(
        "INSERT INTO site_metrics (id, total_views, total_visitors) VALUES (1, 1, ?) ON CONFLICT(id) DO UPDATE SET total_views = total_views + 1, total_visitors = total_visitors + excluded.total_visitors"
      )
      .bind(newVisitor),
    db
      .prepare(
        "INSERT INTO daily_metrics (day, views, unique_visitors) VALUES (?, 1, ?) ON CONFLICT(day) DO UPDATE SET views = views + 1, unique_visitors = unique_visitors + excluded.unique_visitors"
      )
      .bind(day, newVisitorToday),
    db
      .prepare(
        "INSERT INTO analytics_events (id, visitor_key, path, query_string, page_title, referrer, ip_address, user_agent, accept_language, client_language, client_timezone, screen_width, screen_height, viewport_width, viewport_height, country, region, city, postal_code, edge_timezone, latitude, longitude, asn, colo, http_protocol, tls_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        crypto.randomUUID(),
        visitor.value,
        String(body.path || "/").slice(0, 2048),
        String(body.queryString || "").slice(0, 4096),
        String(body.pageTitle || "").slice(0, 512),
        String(body.referrer || request.headers.get("referer") || "").slice(0, 4096),
        String(request.headers.get("cf-connecting-ip") || "").slice(0, 128),
        String(request.headers.get("user-agent") || "").slice(0, 2048),
        String(request.headers.get("accept-language") || "").slice(0, 512),
        String(body.clientLanguage || "").slice(0, 128),
        String(body.clientTimezone || "").slice(0, 128),
        Number.isFinite(body.screenWidth) ? body.screenWidth : null,
        Number.isFinite(body.screenHeight) ? body.screenHeight : null,
        Number.isFinite(body.viewportWidth) ? body.viewportWidth : null,
        Number.isFinite(body.viewportHeight) ? body.viewportHeight : null,
        String(edge.country || "").slice(0, 64),
        String(edge.region || "").slice(0, 256),
        String(edge.city || "").slice(0, 256),
        String(edge.postalCode || "").slice(0, 64),
        String(edge.timezone || "").slice(0, 128),
        String(edge.latitude || "").slice(0, 64),
        String(edge.longitude || "").slice(0, 64),
        Number.isFinite(edge.asn) ? edge.asn : null,
        String(edge.colo || "").slice(0, 64),
        String(edge.httpProtocol || "").slice(0, 64),
        String(edge.tlsVersion || "").slice(0, 64)
      ),
  ]);
  return {
    visitor,
    metrics: await readAnalytics(db),
  };
}

function analyticsOwner(request, env) {
  const email = request.headers.get("oai-authenticated-user-email") || "";
  return email && email.toLowerCase() === String(env.ANALYTICS_OWNER_EMAIL || "").toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function analyticsDashboard(db) {
  const metrics = await readAnalytics(db);
  const events = await db
    .prepare(
      "SELECT occurred_at AS occurredAt, visitor_key AS visitorKey, ip_address AS ipAddress, path, query_string AS queryString, referrer, user_agent AS userAgent, accept_language AS acceptLanguage, client_language AS clientLanguage, client_timezone AS clientTimezone, screen_width AS screenWidth, screen_height AS screenHeight, viewport_width AS viewportWidth, viewport_height AS viewportHeight, country, region, city, postal_code AS postalCode, edge_timezone AS edgeTimezone, latitude, longitude, asn, colo, http_protocol AS httpProtocol, tls_version AS tlsVersion FROM analytics_events ORDER BY occurred_at DESC LIMIT 500"
    )
    .all();
  const rows = (events.results || []).map((event) => \`
    <tr>
      <td>\${escapeHtml(event.occurredAt)}</td>
      <td><code>\${escapeHtml(event.visitorKey)}</code></td>
      <td><code>\${escapeHtml(event.ipAddress)}</code></td>
      <td>\${escapeHtml(event.country)} \${escapeHtml(event.region)} \${escapeHtml(event.city)}</td>
      <td>\${escapeHtml(event.path)}\${escapeHtml(event.queryString)}</td>
      <td class="wide">\${escapeHtml(event.referrer)}</td>
      <td class="wide">\${escapeHtml(event.userAgent)}</td>
      <td>\${escapeHtml(event.clientLanguage)} / \${escapeHtml(event.clientTimezone)}</td>
      <td>\${escapeHtml(event.screenWidth)}×\${escapeHtml(event.screenHeight)} / \${escapeHtml(event.viewportWidth)}×\${escapeHtml(event.viewportHeight)}</td>
      <td>\${escapeHtml(event.asn)} / \${escapeHtml(event.colo)} / \${escapeHtml(event.httpProtocol)} / \${escapeHtml(event.tlsVersion)}</td>
    </tr>
  \`).join("");
  return \`<!doctype html>
  <html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
  <title>访问明细 · 《资本论》第一卷</title>
  <style>
    body{margin:0;padding:28px;background:#f3f0e9;color:#24211d;font:14px/1.5 system-ui,sans-serif}
    h1{font:600 30px/1.2 Georgia,serif}.summary{display:flex;gap:30px;margin:22px 0}
    .summary strong{display:block;font-size:26px}.summary span{color:#746f67}
    .table{overflow:auto;border:1px solid #ded9cf;background:#fbfaf7}
    table{border-collapse:collapse;min-width:1900px;width:100%}th,td{padding:9px 11px;border-bottom:1px solid #ded9cf;text-align:left;vertical-align:top}
    th{position:sticky;top:0;background:#ebe6dd}.wide{max-width:320px;overflow-wrap:anywhere}code{font-size:12px}
  </style></head><body>
  <h1>访问明细</h1>
  <div class="summary"><div><strong>\${metrics.totalVisitors}</strong><span>累计访客</span></div><div><strong>\${metrics.totalViews}</strong><span>累计浏览</span></div></div>
  <p>最近 500 条访问事件；时间为 UTC。</p>
  <div class="table"><table><thead><tr><th>时间</th><th>访客 ID</th><th>IP</th><th>地区</th><th>页面</th><th>来源</th><th>浏览器/设备</th><th>语言/时区</th><th>屏幕/视口</th><th>网络/节点</th></tr></thead><tbody>\${rows}</tbody></table></div>
  </body></html>\`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/analytics") {
      if (!request.headers.get("oai-authenticated-user-email")) {
        return Response.redirect(
          new URL("/signin-with-chatgpt?return_to=%2Fanalytics", url),
          302
        );
      }
      if (!analyticsOwner(request, env)) {
        return new Response("Forbidden", { status: 403 });
      }
      return new Response(await analyticsDashboard(env.DB), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        },
      });
    }
    if (url.pathname === "/api/state" && request.method === "GET") {
      return json(progressState);
    }
    if (url.pathname === "/api/adopt" && request.method === "POST") {
      return json({
        error: "线上阅读版为只读。请在本地工作台中采用版本。",
      }, 409);
    }
    if (url.pathname === "/api/analytics/track" && request.method === "POST") {
      const result = await recordVisit(env.DB, request);
      const response = json(result.metrics);
      if (result.visitor.isNewCookie) {
        response.headers.append(
          "set-cookie",
          \`capital_reader_visitor=\${result.visitor.value}; Max-Age=31536000; Path=/; Secure; HttpOnly; SameSite=Lax\`
        );
      }
      return response;
    }
    if (url.pathname === "/api/analytics" && request.method === "GET") {
      return json(await readAnalytics(env.DB));
    }
    if (url.pathname === "/api/analytics/events" && request.method === "GET") {
      if (!analyticsOwner(request, env)) return json({ error: "Forbidden" }, 403);
      const events = await env.DB
        .prepare("SELECT * FROM analytics_events ORDER BY occurred_at DESC LIMIT 500")
        .all();
      return json(events.results || []);
    }
    if (url.pathname === "/health") {
      return json({ ok: true, storage: "deployed-snapshot" });
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(pageHtml, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-cache",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        },
      });
    }
    return new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
`;
await writeFile(
  path.join(root, "dist", "server", "index.js"),
  workerSource,
  "utf8"
);

console.log("线上只读阅读版构建完成");
