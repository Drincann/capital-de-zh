import http from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  createProgressState,
  DEFAULT_PROJECT_ROOT,
} from "./progress-state.mjs";
import { setAdoptedVersion } from "./adoption-state.mjs";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const htmlPath = path.join(root, "public", "index.html");
const projectRoot = path.resolve(
  process.env.CAPITAL_PROJECT_ROOT || process.argv[2] || DEFAULT_PROJECT_ROOT
);

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 8192) throw new Error("请求过大");
  }
  return JSON.parse(body || "{}");
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === "/api/state" && request.method === "GET") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify(await createProgressState(projectRoot)));
      return;
    }
    if (url.pathname === "/api/adopt" && request.method === "POST") {
      const body = await readJsonBody(request);
      if (
        typeof body.unitId !== "string" ||
        typeof body.versionId !== "string"
      ) {
        response.writeHead(400, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: "缺少版本信息" }));
        return;
      }
      const result = await setAdoptedVersion(
        projectRoot,
        body.unitId,
        body.versionId
      );
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify({ ok: true, ...result }));
      return;
    }
    if (url.pathname === "/api/audio/generate" && request.method === "POST") {
      const body = await readJsonBody(request);
      if (typeof body.unitId !== "string" || !body.unitId.trim()) {
        response.writeHead(400, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: "缺少翻译单元" }));
        return;
      }
      const state = await createProgressState(projectRoot);
      const unit = [...(state.frontMatter || []), ...state.parts]
        .flatMap((item) =>
          item.chapters
            ? item.chapters.flatMap((chapter) => chapter.sections || [])
            : item.sections || []
        )
        .find((item) => item.unit_id === body.unitId);
      if (!unit?.adoptedVersionId) {
        response.writeHead(409, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: "这一节还没有采用版本" }));
        return;
      }
      if (unit.audio?.status === "generating") {
        response.writeHead(409, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: "这一节的语音正在生成" }));
        return;
      }
      const controller = path.join(
        projectRoot,
        "audio",
        "scripts",
        "audio-controller.mjs"
      );
      const child = spawn(
        process.execPath,
        [controller, "generate", "--unit", body.unitId],
        {
          cwd: root,
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        }
      );
      child.unref();
      response.writeHead(202, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(
        JSON.stringify({ ok: true, unitId: body.unitId, pid: child.pid })
      );
      return;
    }
    if (url.pathname === "/health") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(
        JSON.stringify({
          ok: true,
          storage: "local-files",
          projectRoot,
        })
      );
      return;
    }
    if (url.pathname !== "/") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const html = await readFile(htmlPath, "utf8");
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    response.end(html);
  } catch (error) {
    response.writeHead(500, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(
      JSON.stringify({
        error: "无法读取本地翻译项目",
        detail: error instanceof Error ? error.message : String(error),
      })
    );
  }
});

server.listen(port, "127.0.0.1", () => {
  const localUrl = `http://127.0.0.1:${port}`;
  console.log(`Local URL: ${localUrl}`);
  console.log(`Project: ${projectRoot}`);
  if (process.argv.includes("--open")) {
    const child = spawn("cmd.exe", ["/c", "start", "", localUrl], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  }
});
