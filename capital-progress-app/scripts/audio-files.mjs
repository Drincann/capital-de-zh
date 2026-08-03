import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const audioVersionPattern = /^[a-z0-9][a-z0-9._-]*$/i;
const audioFilePattern = /^c\d{4}\.mp3$/;

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function optionalJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readyAudioVersion(projectRoot, audioVersionId) {
  if (!audioVersionPattern.test(audioVersionId)) return null;
  const index = await optionalJson(path.join(projectRoot, "audio", "index.json"));
  const record = (index?.audio_versions || []).find(
    (item) =>
      item.audio_version_id === audioVersionId && item.status === "ready",
  );
  if (!record?.manifest_path) return null;

  const versionsRoot = path.resolve(projectRoot, "audio", "versions");
  const manifestPath = path.resolve(projectRoot, record.manifest_path);
  if (!inside(versionsRoot, manifestPath)) return null;
  const manifest = await optionalJson(manifestPath);
  if (
    manifest?.status !== "ready" ||
    manifest.audio_version_id !== audioVersionId ||
    manifest.translation_version_id !== record.translation_version_id ||
    manifest.translation_sha256 !== record.translation_sha256
  ) {
    return null;
  }
  return { record, manifest, manifestPath };
}

async function manifestResponse(projectRoot, repoRoot, audioVersionId) {
  const ready = await readyAudioVersion(projectRoot, audioVersionId);
  if (!ready) return null;
  const content = await optionalJson(
    path.join(
      repoRoot,
      "capital-online-preview",
      "public",
      "content",
      `${ready.manifest.unit_id}.json`,
    ),
  );
  const matchingContent =
    content?.versionId === ready.manifest.translation_version_id &&
    content?.translationSha256 === ready.manifest.translation_sha256
      ? content
      : null;
  const sentenceMetadata = new Map(
    (matchingContent?.sentences || []).map((sentence) => [sentence.id, sentence]),
  );
  return {
    ...ready.manifest,
    chunks: (ready.manifest.chunks || []).map((chunk) => ({
      ...chunk,
      audio_file: `/api/audio/file/${encodeURIComponent(audioVersionId)}/${encodeURIComponent(path.basename(chunk.audio_file))}`,
    })),
    sentences: (ready.manifest.sentences || []).map((sentence) => {
      const metadata = sentenceMetadata.get(sentence.id);
      return {
        ...sentence,
        index: metadata?.index,
        paragraph_index: metadata?.paragraphIndex,
      };
    }),
  };
}

function byteRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value || "");
  if (!match) return null;
  if (!match[1] && !match[2]) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

function notFound(response) {
  response.writeHead(404, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify({ error: "语音资源不存在" }));
}

export async function handleAudioRequest(
  request,
  response,
  url,
  { projectRoot, repoRoot },
) {
  const manifestMatch = /^\/api\/audio\/manifest\/([^/]+)$/.exec(url.pathname);
  const fileMatch = /^\/api\/audio\/file\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (!manifestMatch && !fileMatch) return false;
  if (!["GET", "HEAD"].includes(request.method || "")) {
    response.writeHead(405, { allow: "GET, HEAD" });
    response.end();
    return true;
  }

  if (manifestMatch) {
    const audioVersionId = decodeURIComponent(manifestMatch[1]);
    const manifest = await manifestResponse(projectRoot, repoRoot, audioVersionId);
    if (!manifest) {
      notFound(response);
      return true;
    }
    const body = `${JSON.stringify(manifest)}\n`;
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : body);
    return true;
  }

  const audioVersionId = decodeURIComponent(fileMatch[1]);
  const audioFile = decodeURIComponent(fileMatch[2]);
  if (!audioFilePattern.test(audioFile)) {
    notFound(response);
    return true;
  }
  const ready = await readyAudioVersion(projectRoot, audioVersionId);
  const listed = ready?.manifest.chunks?.some(
    (chunk) => path.basename(chunk.audio_file) === audioFile,
  );
  if (!ready || !listed) {
    notFound(response);
    return true;
  }
  const directory = path.dirname(ready.manifestPath);
  const file = path.resolve(directory, audioFile);
  if (!inside(directory, file)) {
    notFound(response);
    return true;
  }
  const details = await stat(file).catch(() => null);
  if (!details?.isFile()) {
    notFound(response);
    return true;
  }

  const requestedRange = request.headers.range;
  const range = requestedRange ? byteRange(requestedRange, details.size) : null;
  if (requestedRange && !range) {
    response.writeHead(416, {
      "content-range": `bytes */${details.size}`,
      "accept-ranges": "bytes",
    });
    response.end();
    return true;
  }
  const start = range?.start || 0;
  const end = range?.end ?? details.size - 1;
  const headers = {
    "content-type": "audio/mpeg",
    "content-length": end - start + 1,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
  };
  if (range) headers["content-range"] = `bytes ${start}-${end}/${details.size}`;
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === "HEAD") {
    response.end();
  } else {
    createReadStream(file, { start, end }).pipe(response);
  }
  return true;
}
