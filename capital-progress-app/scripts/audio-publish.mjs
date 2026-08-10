import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  EnvHttpProxyAgent,
  ProxyAgent,
  fetch as undiciFetch,
} from "undici";

const publicationFileName = "publications.json";
const localConfigFileName = ".audio-publish.local.json";

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

function normalizedOrigin(value) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new Error("语音发布地址无效");
  return url.origin;
}

export async function loadAudioPublishConfig(appRoot) {
  const local = await readJson(path.join(appRoot, localConfigFileName), {});
  const origin =
    process.env.CAPITAL_AUDIO_PUBLISH_ORIGIN || local?.origin || "";
  const token = process.env.CAPITAL_AUDIO_PUBLISH_TOKEN || local?.token || "";
  const proxy =
    process.env.CAPITAL_AUDIO_PUBLISH_PROXY || local?.proxy || "";
  const minRequestIntervalMs = Number(
    process.env.CAPITAL_AUDIO_PUBLISH_INTERVAL_MS ||
      local?.min_request_interval_ms ||
      750,
  );
  if (!origin || !token) return null;
  return {
    origin: normalizedOrigin(origin),
    token,
    proxy: proxy ? normalizedOrigin(proxy) : "",
    minRequestIntervalMs: Number.isFinite(minRequestIntervalMs)
      ? Math.max(0, Math.min(minRequestIntervalMs, 10_000))
      : 750,
  };
}

export function resolveAudioPublishProxy(
  config = {},
  environment = process.env,
) {
  if (config.proxy) {
    return { kind: "explicit", proxy: config.proxy };
  }
  const allProxy = environment.all_proxy || environment.ALL_PROXY || "";
  const httpProxy =
    environment.http_proxy || environment.HTTP_PROXY || allProxy;
  const httpsProxy =
    environment.https_proxy || environment.HTTPS_PROXY || allProxy;
  if (!httpProxy && !httpsProxy) return null;
  return {
    kind: "environment",
    httpProxy,
    httpsProxy,
    noProxy: environment.no_proxy || environment.NO_PROXY || "",
  };
}

export function createAudioPublishFetch(config, environment = process.env) {
  const proxy = resolveAudioPublishProxy(config, environment);
  if (!proxy) return fetch;
  const dispatcher =
    proxy.kind === "explicit"
      ? new ProxyAgent(proxy.proxy)
      : new EnvHttpProxyAgent({
          httpProxy: proxy.httpProxy || undefined,
          httpsProxy: proxy.httpsProxy || undefined,
          noProxy: proxy.noProxy,
        });
  let nextRequestAt = 0;
  const request = async (input, init = {}) => {
    const waitMs = Math.max(0, nextRequestAt - Date.now());
    if (waitMs) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    nextRequestAt = Date.now() + (config.minRequestIntervalMs || 0);
    return undiciFetch(input, { ...init, dispatcher });
  };
  request.close = () => dispatcher.close();
  return request;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function encodeObjectPath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

async function remoteObjectMatches(config, key, digest, fetchImpl) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetchImpl(
        `${config.origin}/api/audio-assets/${encodeObjectPath(key)}`,
        {
          method: "HEAD",
          headers: { Authorization: `Bearer ${config.token}` },
        },
      );
      if (response.status === 404) return false;
      if (response.ok) {
        return response.headers.get("x-content-sha256") === digest;
      }
      lastError = new Error(`检查线上语音失败（HTTP ${response.status}）`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw lastError || new Error("检查线上语音失败");
}

async function putRemoteObject(config, asset, fetchImpl) {
  if (await remoteObjectMatches(config, asset.key, asset.sha256, fetchImpl)) {
    return "skipped";
  }
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetchImpl(
        `${config.origin}/api/audio-assets/${encodeObjectPath(asset.key)}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${config.token}`,
            "Content-Type": asset.contentType,
            "X-Content-SHA256": asset.sha256,
          },
          body: asset.bytes,
        },
      );
      if (response.ok) {
        await response.arrayBuffer();
        return "uploaded";
      }
      const detail = await response.text().catch(() => "");
      lastError = new Error(
        `上传线上语音失败（HTTP ${response.status}${detail ? `：${detail}` : ""}）`,
      );
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
  }
  throw lastError || new Error("上传线上语音失败");
}

async function audioContext(projectRoot, audioVersionId) {
  const [translationAdoptions, audioAdoptions, index] = await Promise.all([
    readJson(path.join(projectRoot, "manifests", "adoptions.json"), {}),
    readJson(path.join(projectRoot, "audio", "adoptions.json"), {}),
    readJson(path.join(projectRoot, "audio", "index.json"), {
      audio_versions: [],
    }),
  ]);
  const record = (index.audio_versions || []).find(
    (item) =>
      item.audio_version_id === audioVersionId && item.status === "ready",
  );
  if (!record?.manifest_path) throw new Error("语音版本不存在或尚未完成");
  if (translationAdoptions[record.unit_id] !== record.translation_version_id) {
    throw new Error("语音对应的译文已不是当前采用版本");
  }
  if (audioAdoptions[record.translation_version_id] !== audioVersionId) {
    throw new Error("请先采用这个语音版本，再上传到预览站");
  }
  const manifestPath = path.resolve(projectRoot, record.manifest_path);
  const manifest = await readJson(manifestPath);
  if (
    manifest?.status !== "ready" ||
    manifest.audio_version_id !== audioVersionId ||
    manifest.unit_id !== record.unit_id ||
    manifest.translation_version_id !== record.translation_version_id ||
    manifest.translation_sha256 !== record.translation_sha256
  ) {
    throw new Error("语音清单与当前译文不一致");
  }
  return {
    record,
    manifest,
    manifestPath,
    translationAdoptions,
    audioAdoptions,
    index,
  };
}

async function assetsForAudioVersion(context) {
  const directory = path.dirname(context.manifestPath);
  const assets = [];
  const remoteManifest = {
    ...context.manifest,
    chunks: [],
  };
  for (const chunk of context.manifest.chunks || []) {
    const name = path.basename(chunk.audio_file);
    const bytes = await readFile(path.join(directory, name));
    const digest = sha256(bytes);
    const remoteName = `chunks/${digest}.mp3`;
    assets.push({
      key: `${context.record.audio_version_id}/${remoteName}`,
      bytes,
      sha256: digest,
      contentType: "audio/mpeg",
    });
    remoteManifest.chunks.push({ ...chunk, audio_file: remoteName });
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(remoteManifest, null, 2)}\n`);
  const manifestDigest = sha256(manifestBytes);
  const manifestKey = `${context.record.audio_version_id}/manifest-${manifestDigest.slice(0, 20)}.json`;
  assets.push({
    key: manifestKey,
    bytes: manifestBytes,
    sha256: manifestDigest,
    contentType: "application/json; charset=utf-8",
  });
  return {
    assets,
    manifestPath: `/audio/${manifestKey}`,
  };
}

async function readPublications(projectRoot) {
  return readJson(path.join(projectRoot, "audio", publicationFileName), {
    schema_version: 1,
    updated_at: "",
    target_origin: "",
    audio_versions: {},
    adoptions: {},
  });
}

async function updatePublications(projectRoot, update) {
  const file = path.join(projectRoot, "audio", publicationFileName);
  const current = await readPublications(projectRoot);
  const next = await update(current);
  next.schema_version = 1;
  next.updated_at = new Date().toISOString();
  await writeJsonAtomic(file, next);
  return next;
}

async function buildRemoteRegistry(projectRoot, publications) {
  const [translationAdoptions, audioAdoptions, index] = await Promise.all([
    readJson(path.join(projectRoot, "manifests", "adoptions.json"), {}),
    readJson(path.join(projectRoot, "audio", "adoptions.json"), {}),
    readJson(path.join(projectRoot, "audio", "index.json"), {
      audio_versions: [],
    }),
  ]);
  const adoptions = {};
  for (const [translationVersionId, audioVersionId] of Object.entries(
    audioAdoptions,
  )) {
    const publication = publications.audio_versions?.[audioVersionId];
    if (
      !publication ||
      (!publication.published_at &&
        !["uploaded", "published"].includes(publication.status))
    ) {
      continue;
    }
    const record = (index.audio_versions || []).find(
      (item) =>
        item.audio_version_id === audioVersionId &&
        item.translation_version_id === translationVersionId &&
        item.status === "ready",
    );
    if (!record || translationAdoptions[record.unit_id] !== translationVersionId) {
      continue;
    }
    adoptions[translationVersionId] = {
      audio_version_id: audioVersionId,
      unit_id: record.unit_id,
      translation_version_id: translationVersionId,
      translation_sha256: record.translation_sha256,
      manifest_path:
        publication.manifest_path || `/audio/${audioVersionId}/manifest.json`,
    };
  }
  return {
    schema_version: 1,
    updated_at: new Date().toISOString(),
    adoptions,
  };
}

export async function publishAdoptedAudio({
  projectRoot,
  config,
  audioVersionId,
  fetchImpl,
  onProgress = () => {},
}) {
  const request = fetchImpl || createAudioPublishFetch(config);
  const context = await audioContext(projectRoot, audioVersionId);
  const prepared = await assetsForAudioVersion(context);
  const existingPublications = await readPublications(projectRoot);
  const existing = existingPublications.audio_versions?.[audioVersionId];
  if (
    existing?.published_at &&
    existing.translation_version_id === context.record.translation_version_id &&
    existing.translation_sha256 === context.record.translation_sha256 &&
    existing.manifest_path === prepared.manifestPath
  ) {
    let publications = await updatePublications(projectRoot, async (current) => {
      current.audio_versions[audioVersionId] = {
        ...current.audio_versions[audioVersionId],
        status: "published",
        error: "",
      };
      return current;
    });
    const registry = await buildRemoteRegistry(projectRoot, publications);
    const registryBytes = Buffer.from(`${JSON.stringify(registry, null, 2)}\n`);
    await putRemoteObject(
      config,
      {
        key: "adoptions.json",
        bytes: registryBytes,
        sha256: sha256(registryBytes),
        contentType: "application/json; charset=utf-8",
      },
      request,
    );
    publications = await updatePublications(projectRoot, async (current) => {
      current.adoptions = Object.fromEntries(
        Object.entries(registry.adoptions).map(([translationVersionId, value]) => [
          translationVersionId,
          value.audio_version_id,
        ]),
      );
      return current;
    });
    return publications.audio_versions[audioVersionId];
  }
  const { assets } = prepared;
  const totalBytes = assets.reduce((sum, asset) => sum + asset.bytes.length, 0);
  let completedFiles = 0;
  let completedBytes = 0;

  await updatePublications(projectRoot, async (publications) => {
    publications.target_origin = config.origin;
    publications.audio_versions ||= {};
    publications.audio_versions[audioVersionId] = {
      ...(publications.audio_versions[audioVersionId] || {}),
      status: "uploading",
      unit_id: context.record.unit_id,
      translation_version_id: context.record.translation_version_id,
      translation_sha256: context.record.translation_sha256,
      target_origin: config.origin,
      file_count: assets.length,
      byte_size: totalBytes,
      completed_files: 0,
      completed_bytes: 0,
      manifest_path: prepared.manifestPath,
      error: "",
    };
    return publications;
  });

  try {
    for (const asset of assets) {
      await putRemoteObject(config, asset, request);
      completedFiles += 1;
      completedBytes += asset.bytes.length;
      await updatePublications(projectRoot, async (current) => {
        const entry = current.audio_versions?.[audioVersionId];
        if (entry) {
          entry.completed_files = completedFiles;
          entry.completed_bytes = completedBytes;
        }
        return current;
      });
      onProgress({ completedFiles, totalFiles: assets.length, completedBytes, totalBytes });
    }

    let publications = await updatePublications(projectRoot, async (current) => {
      current.audio_versions[audioVersionId].status = "uploaded";
      return current;
    });
    const registry = await buildRemoteRegistry(projectRoot, publications);
    const registryBytes = Buffer.from(`${JSON.stringify(registry, null, 2)}\n`);
    await putRemoteObject(
      config,
      {
        key: "adoptions.json",
        bytes: registryBytes,
        sha256: sha256(registryBytes),
        contentType: "application/json; charset=utf-8",
      },
      request,
    );

    publications = await updatePublications(projectRoot, async (current) => {
      const entry = current.audio_versions[audioVersionId];
      entry.status = "published";
      entry.published_at = new Date().toISOString();
      entry.error = "";
      current.target_origin = config.origin;
      current.adoptions = Object.fromEntries(
        Object.entries(registry.adoptions).map(([translationVersionId, value]) => [
          translationVersionId,
          value.audio_version_id,
        ]),
      );
      return current;
    });
    return publications.audio_versions[audioVersionId];
  } catch (error) {
    await updatePublications(projectRoot, async (publications) => {
      publications.audio_versions ||= {};
      publications.audio_versions[audioVersionId] = {
        ...(publications.audio_versions[audioVersionId] || {}),
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
      return publications;
    });
    throw error;
  }
}

export function createAudioPublishQueue({ projectRoot, config, fetchImpl }) {
  const request = fetchImpl || createAudioPublishFetch(config);
  const waiting = [];
  const pending = new Map();
  let active = null;

  function snapshot() {
    return {
      configured: Boolean(config),
      targetOrigin: config?.origin || "",
      active: active
        ? {
            unitId: active.unitId,
            translationVersionId: active.translationVersionId,
            audioVersionId: active.audioVersionId,
            completedFiles: active.completedFiles,
            totalFiles: active.totalFiles,
            completedBytes: active.completedBytes,
            totalBytes: active.totalBytes,
          }
        : null,
      waiting: waiting.map((item, index) => ({
        unitId: item.unitId,
        translationVersionId: item.translationVersionId,
        audioVersionId: item.audioVersionId,
        position: index + 1,
      })),
    };
  }

  async function startNext() {
    if (active || !waiting.length) return;
    active = waiting.shift();
    try {
      await publishAdoptedAudio({
        projectRoot,
        config,
        audioVersionId: active.audioVersionId,
        fetchImpl: request,
        onProgress(progress) {
          Object.assign(active, progress);
        },
      });
    } catch {
      // The durable publication record carries the user-facing error.
    } finally {
      pending.delete(active.audioVersionId);
      active = null;
      queueMicrotask(startNext);
    }
  }

  function enqueue(item) {
    if (!config) throw new Error("预览站语音发布尚未配置");
    if (pending.has(item.audioVersionId)) {
      return { accepted: false, duplicate: true };
    }
    const queued = {
      ...item,
      completedFiles: 0,
      totalFiles: 0,
      completedBytes: 0,
      totalBytes: 0,
    };
    pending.set(item.audioVersionId, queued);
    waiting.push(queued);
    void startNext();
    return { accepted: true, duplicate: false };
  }

  return { enqueue, snapshot };
}

export function applyAudioPublishQueueState(state, snapshot) {
  state.audioPublishing = {
    configured: snapshot.configured,
    targetOrigin: snapshot.targetOrigin,
  };
  const runtime = new Map();
  if (snapshot.active) {
    runtime.set(snapshot.active.audioVersionId, {
      status: "uploading",
      label: snapshot.active.totalFiles
        ? `上传中 ${snapshot.active.completedFiles}/${snapshot.active.totalFiles}`
        : "正在准备上传",
      ...snapshot.active,
      canPublish: false,
      error: "",
    });
  }
  for (const item of snapshot.waiting || []) {
    runtime.set(item.audioVersionId, {
      status: "queued",
      label: `等待上传 · 第 ${item.position} 个`,
      ...item,
      canPublish: false,
      error: "",
    });
  }
  const units = [...(state.frontMatter || []), ...(state.parts || [])].flatMap(
    (item) =>
      item.chapters
        ? item.chapters.flatMap((chapter) => chapter.sections || [])
        : item.sections || [],
  );
  for (const unit of units) {
    for (const version of unit.versions || []) {
      for (const audio of version.audio?.versions || []) {
        const override = runtime.get(audio.id);
        if (override) audio.publication = { ...(audio.publication || {}), ...override };
      }
      const adoptedAudio = version.audio?.versions?.find((audio) => audio.adopted);
      if (adoptedAudio?.publication) {
        version.audio.publication = adoptedAudio.publication;
      }
    }
    const adoptedVersion = unit.versions?.find(
      (version) => version.id === unit.adoptedVersionId,
    );
    if (adoptedVersion?.audio) unit.audio = adoptedVersion.audio;
  }
  return state;
}
