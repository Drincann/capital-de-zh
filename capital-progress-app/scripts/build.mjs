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

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/state" && request.method === "GET") {
      return json(progressState);
    }
    if (url.pathname === "/api/adopt" && request.method === "POST") {
      return json({
        error: "线上阅读版为只读。请在本地工作台中采用版本。",
      }, 409);
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
