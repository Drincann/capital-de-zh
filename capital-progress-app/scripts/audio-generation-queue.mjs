import { spawn } from "node:child_process";

const generationProxyEnvironmentNames = new Set([
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "node_use_env_proxy",
  "global_agent_http_proxy",
  "npm_config_proxy",
  "npm_config_https_proxy",
]);

function directNetworkEnvironment(environment = process.env) {
  const direct = { ...environment };
  for (const name of Object.keys(direct)) {
    if (generationProxyEnvironmentNames.has(name.toLowerCase())) {
      delete direct[name];
    }
  }
  direct.NO_PROXY = "*";
  return direct;
}

function failureDetail(errorOutput) {
  const lines = errorOutput.trim().split(/\r?\n/).filter(Boolean);
  return (
    lines.find((line) => /^Error:\s+/.test(line)) ||
    lines.find((line) => /生成失败：HTTP/.test(line)) ||
    lines.at(-1) ||
    ""
  );
}

function createAudioGenerationQueue({
  controller,
  cwd,
  executable = process.execPath,
  spawnProcess = spawn,
  environment = process.env,
  onChange = () => {},
}) {
  const waiting = [];
  const pending = new Map();
  const failures = new Map();
  let active = null;
  let revision = 0;

  function snapshot() {
    return {
      active: active
        ? {
            unitId: active.unitId,
            modelId: active.modelId,
            operation: active.operation,
            sentenceId: active.sentenceId || "",
            baseAudioVersionId: active.baseAudioVersionId || "",
            pid: active.pid,
            startedAt: active.startedAt,
          }
        : null,
      waiting: waiting.map((item, index) => ({
        unitId: item.unitId,
        modelId: item.modelId,
        operation: item.operation,
        sentenceId: item.sentenceId || "",
        baseAudioVersionId: item.baseAudioVersionId || "",
        position: index + 1,
        queuedAt: item.queuedAt,
      })),
      failures: [...failures.values()],
      revision,
    };
  }

  function notify() {
    revision += 1;
    onChange(snapshot());
  }

  function finish(item, error = "") {
    if (active !== item) return;
    if (error) {
      failures.set(`${item.unitId}:${item.modelId}`, {
        unitId: item.unitId,
        modelId: item.modelId,
        operation: item.operation,
        sentenceId: item.sentenceId || "",
        status: "failed",
        label:
          item.operation === "patch" ? "语音分块修正失败" : "语音生成失败",
        error,
        failedAt: new Date().toISOString(),
      });
    }
    pending.delete(item.key);
    active = null;
    notify();
    queueMicrotask(startNext);
  }

  function startNext() {
    if (active || waiting.length === 0) return;
    const item = waiting.shift();
    item.startedAt = new Date().toISOString();
    active = item;
    failures.delete(`${item.unitId}:${item.modelId}`);
    let child;
    let errorOutput = "";
    try {
      const arguments_ =
        item.operation === "patch"
          ? [
              controller,
              "patch",
              "--unit",
              item.unitId,
              "--model",
              item.modelId,
              "--base-audio-version",
              item.baseAudioVersionId,
              "--sentence",
              item.sentenceId,
              "--speech-text",
              item.speechText,
            ]
          : [
              controller,
              "generate",
              "--unit",
              item.unitId,
              "--model",
              item.modelId,
            ];
      child = spawnProcess(
        executable,
        arguments_,
        {
          cwd,
          env: directNetworkEnvironment(environment),
          stdio: ["ignore", "ignore", "pipe"],
          windowsHide: true,
        },
      );
      item.pid = child.pid || null;
    } catch (error) {
      finish(item, error instanceof Error ? error.message : "语音任务未能启动");
      return;
    }
    notify();
    child.stderr?.setEncoding?.("utf8");
    child.stderr?.on?.("data", (chunk) => {
      errorOutput = `${errorOutput}${chunk}`.slice(-4_000);
    });
    child.once("error", (error) =>
      finish(item, error instanceof Error ? error.message : "语音任务未能启动")
    );
    child.once("exit", (code, signal) => {
      const detail = failureDetail(errorOutput);
      finish(
        item,
        code === 0
          ? ""
          : detail ||
              `语音任务异常结束${signal ? `（${signal}）` : code == null ? "" : `（代码 ${code}）`}`
      );
    });
  }

  function enqueue(unitId, modelId = "seed-audio-1.0") {
    failures.delete(`${unitId}:${modelId}`);
    const key = `${unitId}:${modelId}`;
    const existing = pending.get(key);
    if (existing) {
      return {
        accepted: false,
        duplicate: true,
        ...statusFor(unitId, modelId),
      };
    }
    const item = {
      unitId,
      modelId,
      operation: "generate",
      key,
      queuedAt: new Date().toISOString(),
      startedAt: "",
      pid: null,
    };
    pending.set(key, item);
    waiting.push(item);
    notify();
    startNext();
    return {
      accepted: true,
      duplicate: false,
      ...statusFor(unitId, modelId),
    };
  }

  function enqueuePatch({
    unitId,
    modelId,
    baseAudioVersionId,
    sentenceId,
    speechText,
  }) {
    failures.delete(`${unitId}:${modelId}`);
    const key = `${unitId}:${modelId}:patch:${baseAudioVersionId}:${sentenceId}`;
    const existing = pending.get(key);
    if (existing) {
      return {
        accepted: false,
        duplicate: true,
        ...statusFor(unitId, modelId),
      };
    }
    const item = {
      unitId,
      modelId,
      baseAudioVersionId,
      sentenceId,
      speechText,
      operation: "patch",
      key,
      queuedAt: new Date().toISOString(),
      startedAt: "",
      pid: null,
    };
    pending.set(key, item);
    waiting.push(item);
    notify();
    startNext();
    return {
      accepted: true,
      duplicate: false,
      ...statusFor(unitId, modelId),
    };
  }

  function statusFor(unitId, modelId = "seed-audio-1.0") {
    if (active?.unitId === unitId && active?.modelId === modelId) {
      return { status: "generating", position: 0, pid: active.pid };
    }
    const position = waiting.findIndex(
      (item) => item.unitId === unitId && item.modelId === modelId,
    );
    if (position >= 0) {
      return { status: "queued", position: position + 1, pid: null };
    }
    return null;
  }

  return { enqueue, enqueuePatch, snapshot, statusFor };
}

function applyAudioQueueState(state, queueSnapshot) {
  const runtime = new Map();
  if (queueSnapshot.active) {
    runtime.set(
      `${queueSnapshot.active.unitId}:${queueSnapshot.active.modelId}`,
      {
      status: "generating",
      label:
        queueSnapshot.active.operation === "patch"
          ? "语音分块修正中"
          : "语音生成中",
      operation: queueSnapshot.active.operation || "generate",
      sentenceId: queueSnapshot.active.sentenceId || "",
      queuePosition: 0,
      },
    );
  }
  for (const item of queueSnapshot.waiting || []) {
    runtime.set(`${item.unitId}:${item.modelId}`, {
      status: "queued",
      label: `${item.operation === "patch" ? "语音修正" : "语音生成"}排队中 · 第 ${item.position} 个等待`,
      operation: item.operation || "generate",
      sentenceId: item.sentenceId || "",
      queuePosition: item.position,
    });
  }
  for (const item of queueSnapshot.failures || []) {
    const key = `${item.unitId}:${item.modelId}`;
    if (runtime.has(key)) continue;
    runtime.set(key, {
      status: "failed",
      label: item.label || "语音任务失败",
      operation: item.operation || "generate",
      sentenceId: item.sentenceId || "",
      queuePosition: 0,
      error: item.error || "语音任务未能完成",
      failedAt: item.failedAt || "",
    });
  }

  const units = [...(state.frontMatter || []), ...(state.parts || [])].flatMap(
    (item) =>
      item.chapters
        ? item.chapters.flatMap((chapter) => chapter.sections || [])
        : item.sections || [],
  );
  for (const unit of units) {
    const modelEntries = [...runtime.entries()].filter(([key]) =>
      key.startsWith(`${unit.unit_id}:`),
    );
    if (!modelEntries.length) continue;
    const audio = {
      ...(unit.audio || {}),
    };
    const storedAudioError = audio.error || "";
    audio.models = (audio.models || []).map((model) => {
      const override = runtime.get(`${unit.unit_id}:${model.id}`);
      return override
        ? {
            ...model,
            ...override,
            label: model.label,
            error:
              override.status === "failed" && model.error
                ? model.error
                : override.error || "",
            canGenerate:
              override.status === "failed" && override.operation !== "patch"
                ? model.canGenerate
                : false,
          }
        : model;
    });
    const [, primaryOverride] = modelEntries[0];
    const primaryModelId = modelEntries[0][0].slice(unit.unit_id.length + 1);
    const primaryModel = audio.models.find((model) => model.id === primaryModelId);
    audio.generation = {
      ...primaryOverride,
      modelId: primaryModelId,
      error:
        primaryOverride.status === "failed" && primaryModel?.error
          ? primaryModel.error
          : primaryOverride.error || "",
    };
    audio.canGenerate = audio.models.some((model) => model.canGenerate);
    if (audio.status !== "ready") {
      Object.assign(audio, primaryOverride);
      if (primaryOverride.status === "failed" && storedAudioError) {
        audio.error = storedAudioError;
      }
    }
    unit.audio = audio;
    const adopted = (unit.versions || []).find(
      (version) => version.id === unit.adoptedVersionId,
    );
    if (adopted) adopted.audio = { ...(adopted.audio || {}), ...audio };
  }
  state.audioQueueRevision = Number(queueSnapshot.revision || 0);
  return state;
}

export {
  applyAudioQueueState,
  createAudioGenerationQueue,
  directNetworkEnvironment,
};
