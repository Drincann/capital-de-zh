import { createHash, randomUUID } from "node:crypto";
import {
  access,
  appendFile,
  copyFile,
  link,
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
      text: current.map((sentence) => spokenText(sentence)).join(""),
    });
    current = [];
    characters = 0;
  };
  for (const sentence of sentences) {
    const nextCharacters = characters + [...spokenText(sentence)].length;
    if (
      current.length &&
      (nextCharacters > config.chunking.maximum_characters ||
        current.length >= config.chunking.maximum_sentences)
    ) {
      flush();
    }
    current.push(sentence);
    characters += [...spokenText(sentence)].length;
  }
  flush();
  return chunks;
}

function spokenText(sentence) {
  return String(sentence?.speech_text || sentence?.text || "");
}

function chunkCanBeReused(chunk, baseManifest) {
  const baseChunk = (baseManifest?.chunks || []).find(
    (item) => item.id === chunk.id,
  );
  if (!baseChunk) return false;
  const sentenceIds = chunk.sentences.map((sentence) => sentence.id);
  if (
    sentenceIds.length !== (baseChunk.sentence_ids || []).length ||
    sentenceIds.some((sentenceId, index) => sentenceId !== baseChunk.sentence_ids[index])
  ) {
    return false;
  }
  const baseSentenceById = new Map(
    (baseManifest.sentences || []).map((sentence) => [sentence.id, sentence]),
  );
  return chunk.sentences.every((sentence) => {
    const baseSentence = baseSentenceById.get(sentence.id);
    return (
      baseSentence &&
      String(baseSentence.text || "") === String(sentence.text || "") &&
      spokenText(baseSentence) === spokenText(sentence)
    );
  });
}

function patchedChunks(sourceSentences, baseChunks, overrides = {}) {
  const sentenceById = new Map(
    sourceSentences.map((sentence) => [sentence.id, sentence]),
  );
  return baseChunks.map((baseChunk) => {
    const sentences = (baseChunk.sentence_ids || []).map((sentenceId) => {
      const source = sentenceById.get(sentenceId);
      if (!source) {
        throw new Error(`当前译文中找不到语音句子 ${sentenceId}，不能复用旧分块。`);
      }
      const override = String(overrides[sentenceId] || "").trim();
      return override && override !== source.text
        ? { ...source, speech_text: override }
        : { ...source };
    });
    return {
      id: baseChunk.id,
      sentences,
      text: sentences.map((sentence) => spokenText(sentence)).join(""),
    };
  });
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
        normalized(sentence.text) === normalized(spokenText(sourceSentences[index])),
    )
  ) {
    return sourceSentences.map((sentence, index) => ({
      id: sentence.id,
      text: sentence.text,
      ...(spokenText(sentence) !== sentence.text
        ? { speech_text: spokenText(sentence) }
        : {}),
      start_ms: Number(generated[index].start_time || 0),
      end_ms: Number(generated[index].end_time || 0),
      timing_source: "provider_subtitle",
    }));
  }

  const totalMs = Math.round(Number(durationSeconds || 0) * 1000);
  const weights = sourceSentences.map((sentence) =>
    Math.max(1, [...normalized(spokenText(sentence))].length),
  );
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let elapsed = 0;
  return sourceSentences.map((sentence, index) => {
    const start = Math.round((elapsed / totalWeight) * totalMs);
    elapsed += weights[index];
    return {
      id: sentence.id,
      text: sentence.text,
      ...(spokenText(sentence) !== sentence.text
        ? { speech_text: spokenText(sentence) }
        : {}),
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
    sourceSentences.map((sentence) => spokenText(sentence)).join(""),
  );
  const generatedText = normalized(words.map((word) => word.word).join(""));
  if (!words.length || generatedText !== sourceText) {
    return sentenceTimings(sourceSentences, null, durationSeconds);
  }

  let sourceOffset = 0;
  let wordIndex = 0;
  let generatedOffset = 0;
  return sourceSentences.map((sentence) => {
    const sentenceLength = [...normalized(spokenText(sentence))].length;
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
      ...(spokenText(sentence) !== sentence.text
        ? { speech_text: spokenText(sentence) }
        : {}),
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

async function generationEstimate(unitId, modelId = "") {
  if (!unitId) throw new Error("缺少 --unit。");
  const [config, source] = await Promise.all([
    loadModelProfile(modelId),
    adoptedVersion(unitId),
  ]);
  const content = await narrationContent(source);
  const planned = makeChunks(content.sentences, config);
  const configSha256 = sha256(JSON.stringify(config));
  const audioVersionId = `${source.versionId}-audio-${sha256(`${source.translationSha256}:${configSha256}`).slice(0, 12)}`;
  const currentIndex = await readJson(indexPath);
  const legacyConfig = (await exists(configPath))
    ? await readJson(configPath)
    : null;
  const legacyConfigSha256 = legacyConfig
    ? sha256(JSON.stringify(legacyConfig))
    : "";
  const legacyProfileCompatible =
    legacyConfig &&
    config.id === "seed-audio-1.0" &&
    legacyConfig.model === config.model &&
    legacyConfig.speaker === config.speaker &&
    legacyConfig.endpoint === config.endpoint &&
    JSON.stringify(legacyConfig.audio_config) === JSON.stringify(config.audio_config) &&
    JSON.stringify(legacyConfig.chunking) === JSON.stringify(config.chunking) &&
    legacyConfig.prompt === config.prompt;
  const baseCandidates = (currentIndex.audio_versions || [])
    .filter(
      (item) =>
        item.audio_version_id !== audioVersionId &&
        item.unit_id === unitId &&
        item.status === "ready" &&
        ((item.model_id === config.id && item.config_sha256 === configSha256) ||
          (!item.model_id &&
            legacyProfileCompatible &&
            item.config_sha256 === legacyConfigSha256)) &&
        item.manifest_path,
    )
    .sort((left, right) =>
      String(right.completed_at || right.updated_at || "").localeCompare(
        String(left.completed_at || left.updated_at || ""),
      ),
    );
  let baseRecord = null;
  let baseManifest = null;
  for (const candidate of baseCandidates) {
    const candidatePath = path.join(projectRoot, candidate.manifest_path);
    if (!(await exists(candidatePath))) continue;
    const candidateManifest = await readJson(candidatePath);
    if (
      candidateManifest.model === config.model &&
      candidateManifest.speaker === config.speaker &&
      (!candidateManifest.transport || candidateManifest.transport === config.transport)
    ) {
      baseRecord = candidate;
      baseManifest = candidateManifest;
      break;
    }
  }
  const reusableChunks = baseManifest
    ? planned.filter((chunk) => chunkCanBeReused(chunk, baseManifest))
    : [];
  const baseReusableIds = new Set(reusableChunks.map((chunk) => chunk.id));
  const versionRoot = path.join(audioRoot, "versions", audioVersionId);
  const cachedChunks = [];
  for (const chunk of planned) {
    if (baseReusableIds.has(chunk.id)) continue;
    const audioPath = path.join(versionRoot, `${chunk.id}.mp3`);
    const metadataPath = path.join(versionRoot, `${chunk.id}.json`);
    if (!(await exists(audioPath)) || !(await exists(metadataPath))) continue;
    const metadata = await readJson(metadataPath).catch(() => null);
    if (metadata?.text_sha256 === sha256(chunk.text)) cachedChunks.push(chunk);
  }
  const reusableIds = new Set([
    ...baseReusableIds,
    ...cachedChunks.map((chunk) => chunk.id),
  ]);
  const generatedChunks = planned.filter((chunk) => !reusableIds.has(chunk.id));
  return {
    unit_id: unitId,
    translation_version_id: source.versionId,
    model_id: config.id,
    model_label: config.label,
    audio_version_id: audioVersionId,
    base_audio_version_id: baseRecord?.audio_version_id || "",
    base_translation_version_id: baseRecord?.translation_version_id || "",
    chunk_count: planned.length,
    base_reusable_chunk_count: reusableChunks.length,
    cached_chunk_count: cachedChunks.length,
    reusable_chunk_count: reusableIds.size,
    generated_chunk_count: generatedChunks.length,
    generated_character_count: generatedChunks.reduce(
      (total, chunk) => total + [...chunk.text].length,
      0,
    ),
  };
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
    const results = new Array(planned.length);
    const currentIndex = await readJson(indexPath);
    const legacyConfig = (await exists(configPath))
      ? await readJson(configPath)
      : null;
    const legacyConfigSha256 = legacyConfig
      ? sha256(JSON.stringify(legacyConfig))
      : "";
    const legacyProfileCompatible =
      legacyConfig &&
      config.id === "seed-audio-1.0" &&
      legacyConfig.model === config.model &&
      legacyConfig.speaker === config.speaker &&
      legacyConfig.endpoint === config.endpoint &&
      JSON.stringify(legacyConfig.audio_config) === JSON.stringify(config.audio_config) &&
      JSON.stringify(legacyConfig.chunking) === JSON.stringify(config.chunking) &&
      legacyConfig.prompt === config.prompt;
    const baseCandidates = (currentIndex.audio_versions || [])
      .filter(
        (item) =>
          item.audio_version_id !== audioVersionId &&
          item.unit_id === unitId &&
          item.status === "ready" &&
          ((item.model_id === config.id && item.config_sha256 === configSha256) ||
            (!item.model_id &&
              legacyProfileCompatible &&
              item.config_sha256 === legacyConfigSha256)) &&
          item.manifest_path,
      )
      .sort((left, right) =>
        String(right.completed_at || right.updated_at || "").localeCompare(
          String(left.completed_at || left.updated_at || ""),
        ),
      );
    let baseRecord = null;
    let baseManifest = null;
    let baseManifestPath = "";
    for (const candidate of baseCandidates) {
      const candidatePath = path.join(projectRoot, candidate.manifest_path);
      if (!(await exists(candidatePath))) continue;
      const candidateManifest = await readJson(candidatePath);
      if (
        candidateManifest.model === config.model &&
        candidateManifest.speaker === config.speaker &&
        (!candidateManifest.transport || candidateManifest.transport === config.transport)
      ) {
        baseRecord = candidate;
        baseManifest = candidateManifest;
        baseManifestPath = candidatePath;
        break;
      }
    }

    let reusedChunkCount = 0;
    if (baseManifest) {
      const baseDirectory = path.dirname(baseManifestPath);
      for (let current = 0; current < planned.length; current += 1) {
        const chunk = planned[current];
        if (!chunkCanBeReused(chunk, baseManifest)) continue;
        const baseChunk = baseManifest.chunks.find((item) => item.id === chunk.id);
        const audioFile = baseChunk.audio_file || `${chunk.id}.mp3`;
        const metadataFile = `${chunk.id}.json`;
        const sourceAudio = path.join(baseDirectory, audioFile);
        const sourceMetadata = path.join(baseDirectory, metadataFile);
        if (!(await exists(sourceAudio)) || !(await exists(sourceMetadata))) continue;
        await linkOrCopy(sourceAudio, path.join(versionRoot, audioFile));
        await linkOrCopy(sourceMetadata, path.join(versionRoot, metadataFile));
        results[current] = await readJson(path.join(versionRoot, metadataFile));
        reusedChunkCount += 1;
      }
    }

    const pendingIndexes = planned
      .map((_, index) => index)
      .filter((index) => !results[index]);
    let apiKey = "";
    if (pendingIndexes.length) {
      const keyFile = path.resolve(
        process.env.VOLCENGINE_API_KEY_FILE ||
          path.join(repoRoot, "keys", "volcengine-api-key.txt"),
      );
      apiKey = (await readFile(keyFile, "utf8")).trim();
      if (!apiKey) throw new Error("语音 API 密钥文件为空。");
    }

    let completed = reusedChunkCount;
    await updateIndex((index) => {
      const record = index.audio_versions.find(
        (item) => item.audio_version_id === audioVersionId,
      );
      if (record) {
        record.completed_chunks = completed;
        record.chunk_count = planned.length;
        record.reused_chunk_count = reusedChunkCount;
        record.generated_chunk_count = 0;
        if (baseRecord) record.base_audio_version_id = baseRecord.audio_version_id;
      }
    });
    if (baseRecord && reusedChunkCount) {
      await appendJobEvent({
        job_id: jobId,
        unit_id: unitId,
        status: "chunks_reused",
        base_audio_version_id: baseRecord.audio_version_id,
        reused_chunks: reusedChunkCount,
        chunk_count: planned.length,
      });
      process.stdout.write(
        `复用旧语音块 ${reusedChunkCount}/${planned.length}\n`,
      );
    }
    await runWorkerQueue(
      pendingIndexes.length,
      Number(config.generation_concurrency || 1),
      async (queueIndex) => {
        const current = pendingIndexes[queueIndex];
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
            record.generated_chunk_count = completedChunks - reusedChunkCount;
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
      schema_version: baseRecord ? 2 : 1,
      status: "ready",
      audio_version_id: audioVersionId,
      ...(baseRecord
        ? {
            base_audio_version_id: baseRecord.audio_version_id,
            reused_chunk_count: reusedChunkCount,
            generated_chunk_count: pendingIndexes.length,
          }
        : {}),
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
        reused_chunk_count: reusedChunkCount,
        generated_chunk_count: pendingIndexes.length,
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

async function linkOrCopy(source, destination) {
  if (await exists(destination)) return;
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await link(source, destination);
  } catch {
    await copyFile(source, destination);
  }
}

async function patchUnlocked({
  unitId,
  modelId = "",
  baseAudioVersionId,
  sentenceId,
  speechText,
}) {
  if (!unitId || !baseAudioVersionId || !sentenceId || !String(speechText).trim()) {
    throw new Error("局部语音修正缺少必要参数。");
  }

  const source = await adoptedVersion(unitId);
  const index = await readJson(indexPath);
  const baseRecord = (index.audio_versions || []).find(
    (item) =>
      item.audio_version_id === baseAudioVersionId &&
      item.unit_id === unitId &&
      item.translation_version_id === source.versionId &&
      item.translation_sha256 === source.translationSha256 &&
      item.status === "ready",
  );
  if (!baseRecord?.manifest_path) {
    throw new Error("只能从当前译文已经完成的语音版本创建修补版。");
  }

  const config = await loadModelProfile(modelId || baseRecord.model_id);
  const configSha256 = sha256(JSON.stringify(config));
  const baseManifestPath = path.join(projectRoot, baseRecord.manifest_path);
  const baseManifest = await readJson(baseManifestPath);
  if (
    (baseManifest.model && baseManifest.model !== config.model) ||
    (baseManifest.speaker && baseManifest.speaker !== config.speaker) ||
    (baseManifest.transport && baseManifest.transport !== config.transport)
  ) {
    throw new Error("当前模型或音色与基础语音版本不一致，无法复用旧分块。");
  }
  const content = await narrationContent(source);
  const sourceSentence = content.sentences.find((item) => item.id === sentenceId);
  const baseSentence = (baseManifest.sentences || []).find(
    (item) => item.id === sentenceId,
  );
  const baseChunk = (baseManifest.chunks || []).find((item) =>
    (item.sentence_ids || []).includes(sentenceId),
  );
  if (!sourceSentence || !baseSentence || !baseChunk) {
    throw new Error("所选句子与基础语音版本不匹配，无法局部修正。");
  }

  const replacement = String(speechText).replace(/\s+/g, " ").trim();
  const currentSpoken = String(baseSentence.speech_text || baseSentence.text || "");
  if (replacement === currentSpoken) {
    throw new Error("朗读文本没有变化。");
  }

  const speechOverrides = {
    ...(baseManifest.speech_overrides || {}),
    [sentenceId]: replacement,
  };
  const overrideSha256 = sha256(JSON.stringify(speechOverrides));
  const audioVersionId = `${source.versionId}-audio-${sha256(
    `${source.translationSha256}:${baseRecord.config_sha256}:${configSha256}:${overrideSha256}`,
  ).slice(0, 12)}`;
  const versionRoot = path.join(audioRoot, "versions", audioVersionId);
  const manifestPath = path.join(versionRoot, "manifest.json");
  const relativeManifestPath = path
    .relative(projectRoot, manifestPath)
    .replaceAll("\\", "/");
  const existing = (index.audio_versions || []).find(
    (item) => item.audio_version_id === audioVersionId && item.status === "ready",
  );
  if (existing && (await exists(manifestPath))) return readJson(manifestPath);

  const planned = patchedChunks(
    content.sentences,
    baseManifest.chunks || [],
    speechOverrides,
  );
  const targetChunk = planned.find((item) => item.id === baseChunk.id);
  if (!targetChunk) throw new Error("找不到需要重新生成的语音分块。");

  const jobId = `audio-patch-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  await mkdir(versionRoot, { recursive: true });
  await updateIndex((next) => {
    next.audio_versions = (next.audio_versions || []).filter(
      (item) => item.audio_version_id !== audioVersionId,
    );
    next.audio_versions.push({
      audio_version_id: audioVersionId,
      unit_id: unitId,
      translation_version_id: source.versionId,
      translation_sha256: source.translationSha256,
      config_sha256: configSha256,
      base_config_sha256: baseRecord.config_sha256,
      model_id: config.id,
      model_label: config.label,
      transport: config.transport,
      status: "generating",
      manifest_path: relativeManifestPath,
      base_audio_version_id: baseAudioVersionId,
      patched_chunk_id: targetChunk.id,
      speech_override_count: Object.keys(speechOverrides).length,
      created_at: startedAt,
      updated_at: startedAt,
      completed_chunks: Math.max(0, planned.length - 1),
      chunk_count: planned.length,
    });
    next.jobs = [
      {
        job_id: jobId,
        unit_id: unitId,
        translation_version_id: source.versionId,
        audio_version_id: audioVersionId,
        model_id: config.id,
        model_label: config.label,
        operation: "patch",
        sentence_id: sentenceId,
        chunk_id: targetChunk.id,
        status: "generating",
        created_at: startedAt,
        updated_at: startedAt,
      },
      ...(next.jobs || []).filter((item) => item.job_id !== jobId),
    ].slice(0, 80);
  });
  await appendJobEvent({
    job_id: jobId,
    unit_id: unitId,
    status: "patch_started",
    sentence_id: sentenceId,
    chunk_id: targetChunk.id,
  });

  try {
    const baseDirectory = path.dirname(baseManifestPath);
    const results = [];
    for (const chunk of planned) {
      if (chunk.id === targetChunk.id) continue;
      const audioFile = `${chunk.id}.mp3`;
      const metadataFile = `${chunk.id}.json`;
      await linkOrCopy(
        path.join(baseDirectory, audioFile),
        path.join(versionRoot, audioFile),
      );
      if (!(await exists(path.join(versionRoot, metadataFile)))) {
        await copyFile(
          path.join(baseDirectory, metadataFile),
          path.join(versionRoot, metadataFile),
        );
      }
      results.push(await readJson(path.join(versionRoot, metadataFile)));
    }

    const keyFile = path.resolve(
      process.env.VOLCENGINE_API_KEY_FILE ||
        path.join(repoRoot, "keys", "volcengine-api-key.txt"),
    );
    const apiKey = (await readFile(keyFile, "utf8")).trim();
    if (!apiKey) throw new Error("语音 API 密钥文件为空。");
    results.push(
      await generateChunk(
        apiKey,
        config,
        versionRoot,
        targetChunk,
        audioVersionId,
      ),
    );
    const resultByChunk = new Map(results.map((item) => [item.chunk_id, item]));
    const orderedResults = planned.map((item) => resultByChunk.get(item.id));
    if (orderedResults.some((item) => !item)) {
      throw new Error("修补版语音分块没有完整组装。");
    }

    const chunks = orderedResults.map((result) => ({
      id: result.chunk_id,
      audio_file: result.audio_file,
      duration_ms: Math.round(result.duration_seconds * 1000),
      bytes: result.bytes,
      sha256: result.audio_sha256,
      sentence_ids: result.sentences.map((sentence) => sentence.id),
    }));
    const sentences = orderedResults.flatMap((result) =>
      result.sentences.map((sentence) => ({
        ...sentence,
        chunk_id: result.chunk_id,
      })),
    );
    const durationMs = chunks.reduce((sum, chunk) => sum + chunk.duration_ms, 0);
    const completedAt = new Date().toISOString();
    const manifest = {
      schema_version: 2,
      status: "ready",
      audio_version_id: audioVersionId,
      base_audio_version_id: baseAudioVersionId,
      patched_chunk_id: targetChunk.id,
      unit_id: unitId,
      translation_version_id: source.versionId,
      translation_sha256: source.translationSha256,
      config_sha256: configSha256,
      base_config_sha256: baseRecord.config_sha256,
      model_id: config.id,
      model_label: config.label,
      transport: config.transport,
      speaker: config.speaker,
      model: config.model,
      speech_overrides: speechOverrides,
      created_at: startedAt,
      completed_at: completedAt,
      duration_ms: durationMs,
      sentence_count: sentences.length,
      chunks,
      sentences,
    };
    await writeJsonAtomic(manifestPath, manifest);
    await updateIndex((next) => {
      const record = next.audio_versions.find(
        (item) => item.audio_version_id === audioVersionId,
      );
      Object.assign(record, {
        status: "ready",
        updated_at: completedAt,
        completed_at: completedAt,
        completed_chunks: chunks.length,
        chunk_count: chunks.length,
        sentence_count: sentences.length,
        duration_ms: durationMs,
      });
      const job = next.jobs.find((item) => item.job_id === jobId);
      Object.assign(job, {
        status: "ready",
        updated_at: completedAt,
        completed_at: completedAt,
      });
    });
    await appendJobEvent({
      job_id: jobId,
      unit_id: unitId,
      status: "patch_ready",
      audio_version_id: audioVersionId,
      chunk_id: targetChunk.id,
    });
    console.log(`语音修补版已完成：${audioVersionId}`);
    return manifest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateIndex((next) => {
      const record = next.audio_versions.find(
        (item) => item.audio_version_id === audioVersionId,
      );
      if (record) {
        record.status = "failed";
        record.error = message;
        record.updated_at = new Date().toISOString();
      }
      const job = next.jobs.find((item) => item.job_id === jobId);
      if (job) {
        job.status = "failed";
        job.error = message;
        job.updated_at = new Date().toISOString();
      }
    });
    await appendJobEvent({
      job_id: jobId,
      unit_id: unitId,
      status: "patch_failed",
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

async function patchAudio(options) {
  const releaseLock = await acquireDirectoryLock(
    path.join(audioRoot, ".generation.lock"),
  );
  try {
    return await patchUnlocked(options);
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
  else if (command === "estimate") {
    console.log(
      JSON.stringify(
        await generationEstimate(option("--unit"), option("--model")),
        null,
        2,
      ),
    );
  }
  else if (command === "patch") {
    await patchAudio({
      unitId: option("--unit"),
      modelId: option("--model"),
      baseAudioVersionId: option("--base-audio-version"),
      sentenceId: option("--sentence"),
      speechText: option("--speech-text"),
    });
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
  chunkCanBeReused,
  generationEstimate,
  patchedChunks,
  retryTransient,
  runWorkerQueue,
  sentenceTimingsFromWords,
  writeJsonAtomic,
};
