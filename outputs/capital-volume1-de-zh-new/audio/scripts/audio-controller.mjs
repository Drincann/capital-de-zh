import { createHash, randomUUID } from "node:crypto";
import {
  access,
  appendFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptRoot, "..", "..");
const repoRoot = path.resolve(projectRoot, "..", "..");
const audioRoot = path.join(projectRoot, "audio");
const configPath = path.join(audioRoot, "config.json");
const modelsPath = path.join(audioRoot, "models.json");
const indexPath = path.join(audioRoot, "index.json");
const jobsPath = path.join(audioRoot, "jobs.jsonl");
const previewRoot = path.join(repoRoot, "capital-online-preview");

const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function loadModelProfile(modelId = "") {
  if (!(await exists(modelsPath))) {
    const legacy = await readJson(configPath);
    return {
      ...legacy,
      id: legacy.model || "seed-audio-1.0",
      label: "现有模型 1.0",
      transport: "audio-create-http",
    };
  }
  const catalog = await readJson(modelsPath);
  const selectedId = modelId || catalog.default_model_id;
  const profile = (catalog.models || []).find((item) => item.id === selectedId);
  if (!profile) throw new Error(`未知语音模型：${selectedId}`);
  return profile;
}

const atomicWriteQueues = new Map();

async function writeJsonAtomicOnce(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function writeJsonAtomic(file, value) {
  const previous = atomicWriteQueues.get(file) || Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(() => writeJsonAtomicOnce(file, value));
  atomicWriteQueues.set(file, operation);
  try {
    await operation;
  } finally {
    if (atomicWriteQueues.get(file) === operation) atomicWriteQueues.delete(file);
  }
}

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function isRetryableGenerationError(error) {
  const status = Number(error?.status || 0);
  if (status === 408 || status === 409 || status === 425 || status === 429) {
    return true;
  }
  if (status >= 500 && status <= 599) return true;
  if (error?.name === "AbortError" || error?.name === "TimeoutError") return true;
  return /fetch failed|network|socket|ECONNRESET|ETIMEDOUT|EAI_AGAIN|closed the stream/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

async function retryTransient(
  operation,
  {
    maxAttempts = 8,
    baseDelayMs = 3_000,
    maximumDelayMs = 60_000,
    onRetry = async () => {},
    sleep = delay,
  } = {},
) {
  let attempt = 1;
  while (true) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableGenerationError(error)) {
        throw error;
      }
      const backoffDelayMs = Math.min(
        maximumDelayMs,
        Math.round(baseDelayMs * 2 ** (attempt - 1) * (0.85 + Math.random() * 0.3)),
      );
      const delayMs = Math.max(
        backoffDelayMs,
        Math.min(maximumDelayMs, Number(error?.retryAfterMs || 0)),
      );
      await onRetry({ attempt, nextAttempt: attempt + 1, delayMs, error });
      await sleep(delayMs);
      attempt += 1;
    }
  }
}

async function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireDirectoryLock(
  lockDirectory,
  {
    pollIntervalMs = 1_000,
    ownerlessStaleMs = 30_000,
    maximumWaitMs = 12 * 60 * 60 * 1_000,
    sleep = delay,
  } = {},
) {
  const ownerPath = path.join(lockDirectory, "owner.json");
  const waitStartedAt = Date.now();
  while (true) {
    try {
      await mkdir(lockDirectory);
      await writeFile(
        ownerPath,
        `${JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() }, null, 2)}\n`,
        "utf8",
      );
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await rm(lockDirectory, { recursive: true, force: true });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }

    let stale = false;
    try {
      const owner = await readJson(ownerPath);
      stale = !(await processIsRunning(Number(owner.pid)));
    } catch {
      try {
        const details = await stat(lockDirectory);
        stale = Date.now() - details.mtimeMs >= ownerlessStaleMs;
      } catch {
        continue;
      }
    }
    if (stale) {
      await rm(lockDirectory, { recursive: true, force: true }).catch(() => {});
      continue;
    }
    if (Date.now() - waitStartedAt >= maximumWaitMs) {
      throw new Error("等待其他语音生成任务完成超时。");
    }
    await sleep(pollIntervalMs);
  }
}

function createSerializedJsonUpdater(file) {
  let queue = Promise.resolve();
  return (mutator) => {
    const update = queue.then(async () => {
      const value = await readJson(file);
      mutator(value);
      value.updated_at = new Date().toISOString();
      await writeJsonAtomic(file, value);
      return value;
    });
    queue = update.catch(() => {});
    return update;
  };
}

async function runWorkerQueue(itemCount, concurrency, worker) {
  let cursor = 0;
  let firstError = null;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, itemCount || 1)) },
    async () => {
      while (cursor < itemCount && !firstError) {
        const current = cursor;
        cursor += 1;
        try {
          await worker(current);
        } catch (error) {
          firstError ||= error;
        }
      }
    },
  );
  await Promise.all(workers);
  if (firstError) throw firstError;
}

async function appendJobEvent(event) {
  await appendFile(
    jobsPath,
    `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
    "utf8",
  );
}

function parseJsonLines(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

async function adoptedVersion(unitId) {
  const [adoptions, versionsText] = await Promise.all([
    readJson(path.join(projectRoot, "manifests", "adoptions.json")),
    readFile(path.join(projectRoot, "manifests", "unit-versions.jsonl"), "utf8"),
  ]);
  const versionId = adoptions[unitId];
  if (!versionId) throw new Error(`翻译单元 ${unitId} 尚未采用任何版本。`);
  const version = parseJsonLines(versionsText).find(
    (item) => item.version_id === versionId && item.unit_id === unitId,
  );
  if (!version?.artifact_path) {
    throw new Error(`找不到采用版本 ${versionId} 的译文文件。`);
  }
  const artifactPath = path.join(projectRoot, version.artifact_path);
  const bytes = await readFile(artifactPath);
  return {
    unitId,
    versionId,
    artifactPath,
    translationSha256: sha256(bytes),
  };
}

async function runExport() {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(previewRoot, "scripts", "export-release.mjs")],
      {
        cwd: previewRoot,
        env: { ...process.env, CAPITAL_PROJECT_ROOT: projectRoot },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let errors = "";
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(errors.trim() || `正文导出失败：${code}`));
    });
  });
}

async function narrationContent(source) {
  let content;
  const contentPath = path.join(
    previewRoot,
    "public",
    "content",
    `${source.unitId}.json`,
  );
  if (await exists(contentPath)) content = await readJson(contentPath);
  if (
    content?.versionId !== source.versionId ||
    content?.translationSha256 !== source.translationSha256 ||
    !Array.isArray(content?.sentences)
  ) {
    await runExport();
    content = await readJson(contentPath);
  }
  if (
    content.versionId !== source.versionId ||
    content.translationSha256 !== source.translationSha256
  ) {
    throw new Error("语音正文与当前采用译文不一致，已停止生成。");
  }
  if (!content.sentences.length) {
    throw new Error("当前译文没有可朗读的正文句子。");
  }
  return content;
}

function makeChunks(sentences, config) {
  const chunks = [];
  let current = [];
  let characters = 0;
  const flush = () => {
    if (!current.length) return;
    chunks.push({
      id: `c${String(chunks.length + 1).padStart(4, "0")}`,
      sentences: current,
      text: current.map((sentence) => sentence.text).join(""),
    });
    current = [];
    characters = 0;
  };
  for (const sentence of sentences) {
    const nextCharacters = characters + [...sentence.text].length;
    if (
      current.length &&
      (nextCharacters > config.chunking.maximum_characters ||
        current.length >= config.chunking.maximum_sentences)
    ) {
      flush();
    }
    current.push(sentence);
    characters += [...sentence.text].length;
  }
  flush();
  return chunks;
}

function normalized(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function parseJsonStream(value) {
  const source = String(value || "").replace(/^\uFEFF/, "");
  const results = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (start < 0) {
      if (/\s/.test(character)) continue;
      if (character !== "{") {
        throw new Error(`语音接口返回了无法识别的数据：${source.slice(index, index + 80)}`);
      }
      start = index;
      depth = 1;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        results.push(JSON.parse(source.slice(start, index + 1)));
        start = -1;
      }
    }
  }
  if (start >= 0 || inString || depth !== 0) {
    throw new Error("语音接口返回了不完整的 JSON 数据。");
  }
  if (!results.length) throw new Error("语音接口没有返回任何数据。");
  return results;
}

function sentenceTimings(sourceSentences, subtitle, durationSeconds) {
  const generated = Array.isArray(subtitle?.sentences)
    ? subtitle.sentences
    : [];
  if (
    generated.length === sourceSentences.length &&
    generated.every(
      (sentence, index) =>
        normalized(sentence.text) === normalized(sourceSentences[index].text),
    )
  ) {
    return sourceSentences.map((sentence, index) => ({
      id: sentence.id,
      text: sentence.text,
      start_ms: Number(generated[index].start_time || 0),
      end_ms: Number(generated[index].end_time || 0),
      timing_source: "provider_subtitle",
    }));
  }

  const totalMs = Math.round(Number(durationSeconds || 0) * 1000);
  const weights = sourceSentences.map((sentence) =>
    Math.max(1, [...normalized(sentence.text)].length),
  );
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let elapsed = 0;
  return sourceSentences.map((sentence, index) => {
    const start = Math.round((elapsed / totalWeight) * totalMs);
    elapsed += weights[index];
    return {
      id: sentence.id,
      text: sentence.text,
      start_ms: start,
      end_ms: Math.round((elapsed / totalWeight) * totalMs),
      timing_source: "duration_interpolation",
    };
  });
}

function sentenceTimingsFromWords(
  sourceSentences,
  providerSentences,
  durationSeconds,
) {
  const words = (providerSentences || [])
    .flatMap((sentence) => sentence?.words || [])
    .filter(
      (word) =>
        normalized(word?.word) &&
        Number.isFinite(Number(word?.startTime)) &&
        Number.isFinite(Number(word?.endTime)),
    );
  const sourceText = normalized(
    sourceSentences.map((sentence) => sentence.text).join(""),
  );
  const generatedText = normalized(words.map((word) => word.word).join(""));
  if (!words.length || generatedText !== sourceText) {
    return sentenceTimings(sourceSentences, null, durationSeconds);
  }

  let sourceOffset = 0;
  let wordIndex = 0;
  let generatedOffset = 0;
  return sourceSentences.map((sentence) => {
    const sentenceLength = [...normalized(sentence.text)].length;
    const sentenceStart = sourceOffset;
    const sentenceEnd = sourceOffset + sentenceLength;
    while (
      wordIndex < words.length &&
      generatedOffset + [...normalized(words[wordIndex].word)].length <= sentenceStart
    ) {
      generatedOffset += [...normalized(words[wordIndex].word)].length;
      wordIndex += 1;
    }
    const firstWord = words[Math.min(wordIndex, words.length - 1)];
    let lastWord = firstWord;
    let cursor = wordIndex;
    let cursorOffset = generatedOffset;
    while (cursor < words.length && cursorOffset < sentenceEnd) {
      lastWord = words[cursor];
      cursorOffset += [...normalized(words[cursor].word)].length;
      cursor += 1;
    }
    sourceOffset = sentenceEnd;
    wordIndex = cursor;
    generatedOffset = cursorOffset;
    return {
      id: sentence.id,
      text: sentence.text,
      start_ms: Math.round(Number(firstWord.startTime) * 1000),
      end_ms: Math.round(Number(lastWord.endTime) * 1000),
      timing_source: "provider_word_timestamps",
    };
  });
}

async function generateAudioCreateChunkRequest(apiKey, config, directory, chunk) {
  const audioFile = `${chunk.id}.mp3`;
  const metadataFile = `${chunk.id}.json`;
  const audioPath = path.join(directory, audioFile);
  const metadataPath = path.join(directory, metadataFile);
  if ((await exists(audioPath)) && (await exists(metadataPath))) {
    const cached = await readJson(metadataPath);
    if (cached.text_sha256 === sha256(chunk.text)) return cached;
  }

  const requestId = randomUUID();
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
      "X-Api-Request-Id": requestId,
    },
    body: JSON.stringify({
      model: config.model,
      text_prompt: `${config.prompt}\n\n正文：${chunk.text}`,
      references: [{ speaker: config.speaker }],
      audio_config: config.audio_config,
      watermark: {},
    }),
    signal: AbortSignal.timeout(300_000),
  });
  const logId = response.headers.get("x-tt-logid") || "";
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (!payload.audio && !payload.url)) {
    const error = new Error(
      `${chunk.id} 生成失败：HTTP ${response.status} ${payload.message || payload.code || "缺少音频"} logid=${logId}`,
    );
    error.status = response.status;
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      const retryAt = Date.parse(retryAfter);
      error.retryAfterMs = Number.isFinite(seconds)
        ? seconds * 1_000
        : Number.isFinite(retryAt)
          ? Math.max(0, retryAt - Date.now())
          : 0;
    }
    throw error;
  }

  let audioBytes;
  if (payload.audio) {
    audioBytes = Buffer.from(payload.audio, "base64");
  } else {
    const audioResponse = await fetch(payload.url, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!audioResponse.ok) {
      const error = new Error(
        `${chunk.id} 音频下载失败：HTTP ${audioResponse.status}`,
      );
      error.status = audioResponse.status;
      throw error;
    }
    audioBytes = Buffer.from(await audioResponse.arrayBuffer());
  }
  await writeFile(audioPath, audioBytes);
  const metadata = {
    chunk_id: chunk.id,
    audio_file: audioFile,
    text_sha256: sha256(chunk.text),
    request_id: requestId,
    log_id: logId,
    duration_seconds: Number(payload.duration || payload.original_duration || 0),
    bytes: audioBytes.length,
    audio_sha256: sha256(audioBytes),
    sentences: sentenceTimings(
      chunk.sentences,
      payload.subtitle,
      payload.duration || payload.original_duration,
    ),
  };
  await writeJsonAtomic(metadataPath, metadata);
  return metadata;
}

async function generateTtsHttpChunkRequest(
  apiKey,
  config,
  directory,
  chunk,
  sectionId,
) {
  const audioFile = `${chunk.id}.mp3`;
  const metadataFile = `${chunk.id}.json`;
  const audioPath = path.join(directory, audioFile);
  const metadataPath = path.join(directory, metadataFile);
  if ((await exists(audioPath)) && (await exists(metadataPath))) {
    const cached = await readJson(metadataPath);
    if (cached.text_sha256 === sha256(chunk.text)) return cached;
  }

  const requestId = randomUUID();
  const requestParams = {
    text: chunk.text,
    model: config.model,
    speaker: config.speaker,
    audio_params: config.audio_config,
    additions: JSON.stringify({
      disable_markdown_filter: true,
      disable_emoji_filter: true,
      explicit_language: "zh-cn",
    }),
    section_id: sectionId,
  };
  if (config.prompt) requestParams.context_texts = [config.prompt];

  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Connection: "keep-alive",
      "X-Api-Key": apiKey,
      "X-Api-Resource-Id": config.resource_id,
      "X-Api-Request-Id": requestId,
      "X-Control-Require-Usage-Tokens-Return": "*",
    },
    body: JSON.stringify({ req_params: requestParams }),
    signal: AbortSignal.timeout(300_000),
  });
  const logId = response.headers.get("x-tt-logid") || "";
  const body = await response.text();
  if (!response.ok) {
    const error = new Error(
      `${chunk.id} 生成失败：HTTP ${response.status} ${body.slice(0, 300)} logid=${logId}`,
    );
    error.status = response.status;
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      const retryAt = Date.parse(retryAfter);
      error.retryAfterMs = Number.isFinite(seconds)
        ? seconds * 1_000
        : Number.isFinite(retryAt)
          ? Math.max(0, retryAt - Date.now())
          : 0;
    }
    throw error;
  }

  const responses = parseJsonStream(body);
  const audioParts = [];
  const providerSentences = [];
  const usage = {};
  for (const item of responses) {
    const code = Number(item.code || 0);
    if (code !== 0 && code !== 20_000_000) {
      throw new Error(
        `${chunk.id} 生成失败：${code} ${item.message || "语音接口返回错误"}`,
      );
    }
    if (item.data) audioParts.push(Buffer.from(item.data, "base64"));
    if (item.sentence && typeof item.sentence === "object") {
      providerSentences.push(item.sentence);
    }
    if (item.usage && typeof item.usage === "object") {
      Object.assign(usage, item.usage);
    }
  }
  if (!audioParts.length) {
    throw new Error(`${chunk.id} 生成失败：语音接口没有返回音频。`);
  }

  const audioBytes = Buffer.concat(audioParts);
  const providerWords = providerSentences.flatMap(
    (sentence) => sentence.words || [],
  );
  const lastWordEnd = Math.max(
    0,
    ...providerWords.map((word) => Number(word.endTime || 0)),
  );
  if (!lastWordEnd) {
    throw new Error(`${chunk.id} 生成失败：语音接口没有返回可用的字级时间戳。`);
  }
  const durationSeconds = lastWordEnd + 0.15;
  await writeFile(audioPath, audioBytes);
  const metadata = {
    chunk_id: chunk.id,
    audio_file: audioFile,
    text_sha256: sha256(chunk.text),
    request_id: requestId,
    log_id: logId,
    duration_seconds: durationSeconds,
    bytes: audioBytes.length,
    audio_sha256: sha256(audioBytes),
    provider_response_count: responses.length,
    usage,
    sentences: sentenceTimingsFromWords(
      chunk.sentences,
      providerSentences,
      durationSeconds,
    ),
  };
  await writeJsonAtomic(metadataPath, metadata);
  return metadata;
}

async function generateChunk(
  apiKey,
  config,
  directory,
  chunk,
  sectionId,
  onRetry,
) {
  const audioPath = path.join(directory, `${chunk.id}.mp3`);
  const metadataPath = path.join(directory, `${chunk.id}.json`);
  if ((await exists(audioPath)) && (await exists(metadataPath))) {
    const cached = await readJson(metadataPath);
    if (cached.text_sha256 === sha256(chunk.text)) return cached;
  }
  const request =
    config.transport === "tts-unidirectional-http"
      ? () =>
          generateTtsHttpChunkRequest(
            apiKey,
            config,
            directory,
            chunk,
            sectionId,
          )
      : () => generateAudioCreateChunkRequest(apiKey, config, directory, chunk);
  return retryTransient(request, { onRetry });
}

const updateIndex = createSerializedJsonUpdater(indexPath);

async function generateUnlocked(unitId, modelId = "") {
  if (!unitId) throw new Error("缺少 --unit。");
  const [config, source] = await Promise.all([
    loadModelProfile(modelId),
    adoptedVersion(unitId),
  ]);
  const content = await narrationContent(source);
  const configSha256 = sha256(JSON.stringify(config));
  const audioVersionId = `${source.versionId}-audio-${sha256(`${source.translationSha256}:${configSha256}`).slice(0, 12)}`;
  const versionRoot = path.join(audioRoot, "versions", audioVersionId);
  const manifestPath = path.join(versionRoot, "manifest.json");
  const relativeManifestPath = path.relative(projectRoot, manifestPath).replaceAll("\\", "/");
  const jobId = `audio-job-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();

  await mkdir(versionRoot, { recursive: true });
  await updateIndex((index) => {
    index.audio_versions = (index.audio_versions || []).filter(
      (item) => item.audio_version_id !== audioVersionId,
    );
    index.audio_versions.push({
      audio_version_id: audioVersionId,
      unit_id: unitId,
      translation_version_id: source.versionId,
      translation_sha256: source.translationSha256,
      config_sha256: configSha256,
      model_id: config.id,
      model_label: config.label,
      transport: config.transport,
      status: "generating",
      manifest_path: relativeManifestPath,
      created_at: startedAt,
      updated_at: startedAt,
      completed_chunks: 0,
      chunk_count: 0,
    });
    index.jobs = [
      {
        job_id: jobId,
        unit_id: unitId,
        translation_version_id: source.versionId,
        audio_version_id: audioVersionId,
        model_id: config.id,
        model_label: config.label,
        status: "generating",
        created_at: startedAt,
        updated_at: startedAt,
      },
      ...(index.jobs || []).filter((item) => item.job_id !== jobId),
    ].slice(0, 80);
  });
  await appendJobEvent({ job_id: jobId, unit_id: unitId, status: "started" });

  try {
    const planned = makeChunks(content.sentences, config);
    const keyFile = path.resolve(
      process.env.VOLCENGINE_API_KEY_FILE ||
        path.join(repoRoot, "keys", "volcengine-api-key.txt"),
    );
    const apiKey = (await readFile(keyFile, "utf8")).trim();
    if (!apiKey) throw new Error("语音 API 密钥文件为空。");

    const results = new Array(planned.length);
    let completed = 0;
    await runWorkerQueue(
      planned.length,
      Number(config.generation_concurrency || 1),
      async (current) => {
        const chunk = planned[current];
        results[current] = await generateChunk(
          apiKey,
          config,
          versionRoot,
          chunk,
          audioVersionId,
          async ({ nextAttempt, delayMs, error }) => {
            const message = error instanceof Error ? error.message : String(error);
            const retriedAt = new Date().toISOString();
            await updateIndex((index) => {
              const record = index.audio_versions.find(
                (item) => item.audio_version_id === audioVersionId,
              );
              if (record) {
                record.updated_at = retriedAt;
                record.retrying_chunk = chunk.id;
                record.retry_attempt = nextAttempt;
                record.last_retry_error = message;
              }
              const job = index.jobs.find((item) => item.job_id === jobId);
              if (job) job.updated_at = retriedAt;
            });
            await appendJobEvent({
              job_id: jobId,
              unit_id: unitId,
              status: "chunk_retry",
              chunk_id: chunk.id,
              next_attempt: nextAttempt,
              delay_ms: delayMs,
              error: message,
            });
          },
        );
        completed += 1;
        const completedChunks = completed;
        await updateIndex((index) => {
          const record = index.audio_versions.find(
            (item) => item.audio_version_id === audioVersionId,
          );
          if (record) {
            record.completed_chunks = completedChunks;
            record.chunk_count = planned.length;
            record.updated_at = new Date().toISOString();
            delete record.retrying_chunk;
            delete record.retry_attempt;
            delete record.last_retry_error;
          }
        });
        await appendJobEvent({
          job_id: jobId,
          unit_id: unitId,
          status: "chunk_ready",
          chunk_id: chunk.id,
          completed_chunks: completedChunks,
          chunk_count: planned.length,
        });
        process.stdout.write(
          `语音块 ${completedChunks}/${planned.length} ${chunk.id}\n`,
        );
      },
    );

    const chunks = results.map((result) => ({
      id: result.chunk_id,
      audio_file: result.audio_file,
      duration_ms: Math.round(result.duration_seconds * 1000),
      bytes: result.bytes,
      sha256: result.audio_sha256,
      sentence_ids: result.sentences.map((sentence) => sentence.id),
    }));
    const sentences = results.flatMap((result) =>
      result.sentences.map((sentence) => ({
        ...sentence,
        chunk_id: result.chunk_id,
      })),
    );
    const durationMs = chunks.reduce((sum, chunk) => sum + chunk.duration_ms, 0);
    const manifest = {
      schema_version: 1,
      status: "ready",
      audio_version_id: audioVersionId,
      unit_id: unitId,
      translation_version_id: source.versionId,
      translation_sha256: source.translationSha256,
      config_sha256: configSha256,
      model_id: config.id,
      model_label: config.label,
      transport: config.transport,
      speaker: config.speaker,
      model: config.model,
      created_at: startedAt,
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      sentence_count: sentences.length,
      chunks,
      sentences,
    };
    await writeJsonAtomic(manifestPath, manifest);
    await updateIndex((index) => {
      const record = index.audio_versions.find(
        (item) => item.audio_version_id === audioVersionId,
      );
      Object.assign(record, {
        status: "ready",
        updated_at: manifest.completed_at,
        completed_at: manifest.completed_at,
        completed_chunks: chunks.length,
        chunk_count: chunks.length,
        sentence_count: sentences.length,
        duration_ms: durationMs,
      });
      const job = index.jobs.find((item) => item.job_id === jobId);
      Object.assign(job, {
        status: "ready",
        updated_at: manifest.completed_at,
        completed_at: manifest.completed_at,
      });
    });
    await appendJobEvent({ job_id: jobId, unit_id: unitId, status: "ready" });
    console.log(`语音已完成：${audioVersionId}`);
    return manifest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateIndex((index) => {
      const record = index.audio_versions.find(
        (item) => item.audio_version_id === audioVersionId,
      );
      if (record) {
        record.status = "failed";
        record.error = message;
        record.updated_at = new Date().toISOString();
      }
      const job = index.jobs.find((item) => item.job_id === jobId);
      if (job) {
        job.status = "failed";
        job.error = message;
        job.updated_at = new Date().toISOString();
      }
    });
    await appendJobEvent({
      job_id: jobId,
      unit_id: unitId,
      status: "failed",
      error: message,
    });
    throw error;
  }
}

async function generate(unitId, modelId = "") {
  if (!unitId) throw new Error("缺少 --unit。");
  const releaseLock = await acquireDirectoryLock(
    path.join(audioRoot, ".generation.lock"),
  );
  try {
    return await generateUnlocked(unitId, modelId);
  } finally {
    await releaseLock();
  }
}

async function validate() {
  const index = await readJson(indexPath);
  const problems = [];
  for (const record of index.audio_versions || []) {
    if (record.status !== "ready") continue;
    const manifestPath = path.join(projectRoot, record.manifest_path);
    if (!(await exists(manifestPath))) {
      problems.push(`${record.audio_version_id}: 缺少 manifest`);
      continue;
    }
    const manifest = await readJson(manifestPath);
    if (
      manifest.translation_version_id !== record.translation_version_id ||
      manifest.translation_sha256 !== record.translation_sha256
    ) {
      problems.push(`${record.audio_version_id}: 版本绑定不一致`);
    }
    for (const chunk of manifest.chunks || []) {
      const file = path.join(path.dirname(manifestPath), chunk.audio_file);
      if (!(await exists(file))) {
        problems.push(`${record.audio_version_id}: 缺少 ${chunk.audio_file}`);
      } else if (sha256(await readFile(file)) !== chunk.sha256) {
        problems.push(`${record.audio_version_id}: ${chunk.audio_file} 哈希不一致`);
      }
    }
    if ((manifest.sentences || []).length !== Number(manifest.sentence_count)) {
      problems.push(`${record.audio_version_id}: 逐句映射数量不一致`);
    }
  }
  if (problems.length) throw new Error(problems.join("\n"));
  console.log(`语音校验通过：${(index.audio_versions || []).filter((item) => item.status === "ready").length} 个就绪版本。`);
}

async function status(unitId) {
  const index = await readJson(indexPath);
  const versions = unitId
    ? (index.audio_versions || []).filter((item) => item.unit_id === unitId)
    : index.audio_versions || [];
  console.log(JSON.stringify({ updated_at: index.updated_at, audio_versions: versions }, null, 2));
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const command = process.argv[2] || "status";
  if (command === "generate") {
    await generate(option("--unit"), option("--model"));
  }
  else if (command === "validate") await validate();
  else if (command === "status") await status(option("--unit"));
  else throw new Error(`未知命令：${command}`);
}

export {
  acquireDirectoryLock,
  createSerializedJsonUpdater,
  isRetryableGenerationError,
  parseJsonStream,
  retryTransient,
  runWorkerQueue,
  sentenceTimingsFromWords,
  writeJsonAtomic,
};
