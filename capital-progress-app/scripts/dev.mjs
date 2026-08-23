import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  createProgressState,
  DEFAULT_PROJECT_ROOT,
} from "./progress-state.mjs";
import { setAdoptedVersion } from "./adoption-state.mjs";
import { setAdoptedAudioVersion } from "./audio-adoption-state.mjs";
import { handleAudioRequest } from "./audio-files.mjs";
import {
  applyAudioQueueState,
  createAudioGenerationQueue,
  directNetworkEnvironment,
} from "./audio-generation-queue.mjs";
import {
  applyAudioPublishQueueState,
  createAudioPublishQueue,
  loadAudioPublishConfig,
} from "./audio-publish.mjs";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const htmlPath = path.join(root, "public", "index.html");
const projectRoot = path.resolve(
  process.env.CAPITAL_PROJECT_ROOT || process.argv[2] || DEFAULT_PROJECT_ROOT
);
const repoRoot = path.resolve(root, "..");
const audioController = path.join(
  projectRoot,
  "audio",
  "scripts",
  "audio-controller.mjs"
);
const audioQueue = createAudioGenerationQueue({
  controller: audioController,
  cwd: root,
});
const audioGenerationPlans = new Map();
const audioPublishConfig = await loadAudioPublishConfig(root);
const audioPublishQueue = createAudioPublishQueue({
  projectRoot,
  config: audioPublishConfig,
});

async function progressState() {
  return applyAudioPublishQueueState(
    applyAudioQueueState(
      await createProgressState(projectRoot),
      audioQueue.snapshot()
    ),
    audioPublishQueue.snapshot()
  );
}

function findUnitContext(state, unitId) {
  for (const group of state.frontMatter || []) {
    const unit = (group.sections || []).find((item) => item.unit_id === unitId);
    if (unit) {
      return {
        unit,
        chapterNumberLabel: group.numberLabel || "",
        chapterTitle: group.title || "",
      };
    }
  }
  for (const part of state.parts || []) {
    for (const chapter of part.chapters || []) {
      const unit = (chapter.sections || []).find((item) => item.unit_id === unitId);
      if (unit) {
        return {
          unit,
          chapterNumberLabel: chapter.numberLabel || "",
          chapterTitle: chapter.title || "",
        };
      }
    }
  }
  return null;
}

function audioConflict(state, active) {
  const context = findUnitContext(state, active.unitId);
  const model = context?.unit.audio?.models?.find(
    (item) => item.id === active.modelId
  );
  const completedChunks = Number(model?.completedChunks || 0);
  const chunkCount = Number(model?.chunkCount || 0);
  const chapterLabel = [context?.chapterNumberLabel, context?.chapterTitle]
    .filter(Boolean)
    .join(" ");
  const sectionTitle = context?.unit.title_zh || "";
  const location = [chapterLabel, sectionTitle && `「${sectionTitle}」`]
    .filter(Boolean)
    .join(" · ") || active.unitId;
  const progress = chunkCount ? `（${completedChunks}/${chunkCount}）` : "";
  const action = active.operation === "patch" ? "修正语音" : "生成语音";
  return {
    error: `${location}正在${action}${progress}，完成后才能开始新的任务。`,
    activeTask: {
      unitId: active.unitId,
      modelId: active.modelId,
      operation: active.operation,
      chapterNumberLabel: context?.chapterNumberLabel || "",
      chapterTitle: context?.chapterTitle || "",
      sectionTitle,
      completedChunks,
      chunkCount,
      startedAt: active.startedAt || "",
    },
  };
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 8192) throw new Error("请求过大");
  }
  return JSON.parse(body || "{}");
}

async function createAudioGenerationPlan(unitId, modelId) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [audioController, "estimate", "--unit", unitId, "--model", modelId],
      {
        cwd: root,
        env: directNetworkEnvironment(process.env),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let output = "";
    let errors = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(errors.trim() || "无法估算语音生成量"));
        return;
      }
      try {
        resolve(JSON.parse(output));
      } catch {
        reject(new Error("语音生成预估结果无效"));
      }
    });
  });
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === "/api/state" && request.method === "GET") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify(await progressState()));
      return;
    }
    if (
      await handleAudioRequest(request, response, url, {
        projectRoot,
        repoRoot,
      })
    ) {
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
      if (
        typeof body.unitId !== "string" ||
        !body.unitId.trim() ||
        typeof body.modelId !== "string" ||
        !body.modelId.trim()
      ) {
        response.writeHead(400, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: "缺少翻译单元或语音模型" }));
        return;
      }
      const plan = audioGenerationPlans.get(body.planToken);
      if (
        !plan ||
        plan.unitId !== body.unitId ||
        plan.modelId !== body.modelId ||
        Date.now() - plan.createdAt > 5 * 60 * 1000
      ) {
        response.writeHead(409, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: "请先查看并确认本次生成量" }));
        return;
      }
      const queueState = audioQueue.snapshot();
      const state = await progressState();
      if (queueState.active || queueState.waiting.length) {
        const conflict = audioConflict(
          state,
          queueState.active || queueState.waiting[0]
        );
        response.writeHead(409, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(conflict));
        return;
      }
      const unit = [...(state.frontMatter || []), ...state.parts]
        .flatMap((item) =>
          item.chapters
            ? item.chapters.flatMap((chapter) => chapter.sections || [])
            : item.sections || []
        )
        .find((item) => item.unit_id === body.unitId);
      if (unit?.adoptedVersionId !== plan.translationVersionId) {
        response.writeHead(409, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: "采用的译文已经变化，请重新预估" }));
        return;
      }
      if (!unit?.adoptedVersionId) {
        response.writeHead(409, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: "这一节还没有采用版本" }));
        return;
      }
      const model = unit.audio?.models?.find(
        (item) => item.id === body.modelId
      );
      if (!model) {
        response.writeHead(400, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: "未知语音模型" }));
        return;
      }
      if (["generating", "queued"].includes(model.status)) {
        response.writeHead(409, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: "这个模型已经在语音队列中" }));
        return;
      }
      if (!model.canGenerate) {
        response.writeHead(409, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: "这个模型已有可用语音" }));
        return;
      }
      audioGenerationPlans.delete(body.planToken);
      const queued = audioQueue.enqueue(body.unitId, body.modelId);
      response.writeHead(202, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(
        JSON.stringify({
          ok: true,
          unitId: body.unitId,
          modelId: body.modelId,
          ...queued,
        })
      );
      return;
    }
    if (url.pathname === "/api/audio/plan" && request.method === "POST") {
      const body = await readJsonBody(request);
      if (
        typeof body.unitId !== "string" ||
        !body.unitId.trim() ||
        typeof body.modelId !== "string" ||
        !body.modelId.trim()
      ) {
        response.writeHead(400, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: "缺少翻译单元或语音模型" }));
        return;
      }
      try {
        const estimate = await createAudioGenerationPlan(body.unitId, body.modelId);
        const planToken = randomUUID();
        audioGenerationPlans.set(planToken, {
          unitId: body.unitId,
          modelId: body.modelId,
          translationVersionId: estimate.translation_version_id,
          createdAt: Date.now(),
        });
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(JSON.stringify({ ok: true, planToken, ...estimate }));
      } catch (error) {
        response.writeHead(500, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : "无法估算语音生成量",
          }),
        );
      }
      return;
    }
    if (url.pathname === "/api/audio/patch" && request.method === "POST") {
      const body = await readJsonBody(request);
      const speechText =
        typeof body.speechText === "string"
          ? body.speechText.replace(/\s+/g, " ").trim()
          : "";
      if (
        typeof body.unitId !== "string" ||
        typeof body.translationVersionId !== "string" ||
        typeof body.baseAudioVersionId !== "string" ||
        typeof body.sentenceId !== "string" ||
        !speechText ||
        speechText.length > 1_200
      ) {
        response.writeHead(400, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: "朗读修正信息不完整" }));
        return;
      }
      const state = await progressState();
      const unit = [...(state.frontMatter || []), ...state.parts]
        .flatMap((item) =>
          item.chapters
            ? item.chapters.flatMap((chapter) => chapter.sections || [])
            : item.sections || []
        )
        .find((item) => item.unit_id === body.unitId);
      const version = unit?.versions?.find(
        (item) =>
          item.id === body.translationVersionId &&
          item.id === unit.adoptedVersionId
      );
      const baseAudioVersion = version?.audio?.versions?.find(
        (item) =>
          item.id === body.baseAudioVersionId && item.status === "ready"
      );
      if (!version || !baseAudioVersion) {
        response.writeHead(409, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(
          JSON.stringify({ error: "只能修正当前采用译文的已完成语音" })
        );
        return;
      }
      const queued = audioQueue.enqueuePatch({
        unitId: body.unitId,
        modelId: baseAudioVersion.modelId,
        baseAudioVersionId: body.baseAudioVersionId,
        sentenceId: body.sentenceId,
        speechText,
      });
      response.writeHead(202, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(
        JSON.stringify({
          ok: true,
          unitId: body.unitId,
          modelId: baseAudioVersion.modelId,
          ...queued,
        })
      );
      return;
    }
    if (url.pathname === "/api/audio/adopt" && request.method === "POST") {
      const body = await readJsonBody(request);
      if (
        typeof body.unitId !== "string" ||
        typeof body.translationVersionId !== "string" ||
        typeof body.audioVersionId !== "string"
      ) {
        response.writeHead(400, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: "缺少语音版本信息" }));
        return;
      }
      let result;
      try {
        result = await setAdoptedAudioVersion(
          projectRoot,
          body.unitId,
          body.translationVersionId,
          body.audioVersionId
        );
      } catch (error) {
        response.writeHead(409, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : "语音版本未能采用",
          })
        );
        return;
      }
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify({ ok: true, ...result }));
      return;
    }
    if (url.pathname === "/api/audio/publish" && request.method === "POST") {
      const body = await readJsonBody(request);
      if (
        typeof body.unitId !== "string" ||
        typeof body.translationVersionId !== "string" ||
        typeof body.audioVersionId !== "string"
      ) {
        response.writeHead(400, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: "缺少语音发布信息" }));
        return;
      }
      const state = await progressState();
      const unit = [...(state.frontMatter || []), ...state.parts]
        .flatMap((item) =>
          item.chapters
            ? item.chapters.flatMap((chapter) => chapter.sections || [])
            : item.sections || []
        )
        .find((item) => item.unit_id === body.unitId);
      const version = unit?.versions?.find(
        (item) => item.id === body.translationVersionId && item.adopted
      );
      const audioVersion = version?.audio?.versions?.find(
        (item) => item.id === body.audioVersionId && item.adopted
      );
      if (!audioVersion || audioVersion.status !== "ready") {
        response.writeHead(409, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(
          JSON.stringify({ error: "只能上传当前采用且已经生成完成的语音" })
        );
        return;
      }
      let queued;
      try {
        queued = audioPublishQueue.enqueue({
          unitId: body.unitId,
          translationVersionId: body.translationVersionId,
          audioVersionId: body.audioVersionId,
        });
      } catch (error) {
        response.writeHead(503, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : "语音上传未能启动",
          })
        );
        return;
      }
      response.writeHead(202, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify({ ok: true, ...queued }));
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
          audioPublishing: Boolean(audioPublishConfig),
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
