import { spawn } from "node:child_process";

function createAudioGenerationQueue({
  controller,
  cwd,
  executable = process.execPath,
  spawnProcess = spawn,
  onChange = () => {},
}) {
  const waiting = [];
  const pending = new Map();
  let active = null;

  function snapshot() {
    return {
      active: active
        ? {
            unitId: active.unitId,
            modelId: active.modelId,
            pid: active.pid,
            startedAt: active.startedAt,
          }
        : null,
      waiting: waiting.map((item, index) => ({
        unitId: item.unitId,
        modelId: item.modelId,
        position: index + 1,
        queuedAt: item.queuedAt,
      })),
    };
  }

  function notify() {
    onChange(snapshot());
  }

  function finish(item) {
    if (active !== item) return;
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
    let child;
    try {
      child = spawnProcess(
        executable,
        [
          controller,
          "generate",
          "--unit",
          item.unitId,
          "--model",
          item.modelId,
        ],
        {
          cwd,
          stdio: "ignore",
          windowsHide: true,
        },
      );
      item.pid = child.pid || null;
    } catch {
      finish(item);
      return;
    }
    notify();
    child.once("error", () => finish(item));
    child.once("exit", () => finish(item));
  }

  function enqueue(unitId, modelId = "seed-audio-1.0") {
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

  return { enqueue, snapshot, statusFor };
}

function applyAudioQueueState(state, queueSnapshot) {
  const runtime = new Map();
  if (queueSnapshot.active) {
    runtime.set(
      `${queueSnapshot.active.unitId}:${queueSnapshot.active.modelId}`,
      {
      status: "generating",
      label: "语音生成中",
      queuePosition: 0,
      },
    );
  }
  for (const item of queueSnapshot.waiting || []) {
    runtime.set(`${item.unitId}:${item.modelId}`, {
      status: "queued",
      label: `语音排队中 · 第 ${item.position} 个等待`,
      queuePosition: item.position,
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
      error: "",
    };
    audio.models = (audio.models || []).map((model) => {
      const override = runtime.get(`${unit.unit_id}:${model.id}`);
      return override
        ? { ...model, ...override, canGenerate: false, error: "" }
        : model;
    });
    const [, primaryOverride] = modelEntries[0];
    audio.generation = {
      ...primaryOverride,
      modelId: modelEntries[0][0].slice(unit.unit_id.length + 1),
    };
    audio.canGenerate = audio.models.some((model) => model.canGenerate);
    if (audio.status !== "ready") Object.assign(audio, primaryOverride);
    unit.audio = audio;
    const adopted = (unit.versions || []).find(
      (version) => version.id === unit.adoptedVersionId,
    );
    if (adopted) adopted.audio = { ...(adopted.audio || {}), ...audio };
  }
  return state;
}

export { applyAudioQueueState, createAudioGenerationQueue };
