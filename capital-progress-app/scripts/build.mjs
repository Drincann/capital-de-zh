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
  ]);
  return {
    visitor,
    metrics: await readAnalytics(db),
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
