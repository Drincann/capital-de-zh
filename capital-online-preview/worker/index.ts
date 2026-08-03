/** Cloudflare Worker entry point. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  AUDIO: R2Bucket;
  AUDIO_UPLOAD_TOKEN?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

const publicAudioPrefix = "/audio/";
const audioAdminPrefix = "/api/audio-assets/";
const immutableAudioCache = "public, max-age=31536000, immutable";

function audioObjectKey(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  let decoded: string;
  try {
    decoded = pathname
      .slice(prefix.length)
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return null;
  }
  if (
    !decoded ||
    decoded.startsWith("/") ||
    decoded.includes("\\") ||
    decoded.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  return `audio/${decoded}`;
}

function isMutableAudioObject(key: string): boolean {
  return key === "audio/adoptions.json";
}

function parseByteRange(value: string | null, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value || "");
  if (!match || (!match[1] && !match[2])) return null;

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
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

function uploadAuthorized(request: Request, env: Env): boolean {
  const expected = env.AUDIO_UPLOAD_TOKEN;
  return Boolean(
    expected && request.headers.get("Authorization") === `Bearer ${expected}`,
  );
}

async function serveAudioObject(
  request: Request,
  env: Env,
  key: string,
): Promise<Response> {
  const stored = await env.AUDIO.head(key);
  if (!stored) return env.ASSETS.fetch(request);

  const headers = new Headers();
  stored.writeHttpMetadata(headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("ETag", stored.httpEtag);
  headers.set(
    "Cache-Control",
    isMutableAudioObject(key) ? "no-store, max-age=0" : immutableAudioCache,
  );
  headers.set("X-Content-Type-Options", "nosniff");

  if (request.method === "HEAD") {
    headers.set("Content-Length", String(stored.size));
    return new Response(null, { status: 200, headers });
  }

  const requestedRange = request.headers.get("Range");
  if (requestedRange) {
    const range = parseByteRange(requestedRange, stored.size);
    if (!range) {
      headers.set("Content-Range", `bytes */${stored.size}`);
      return new Response(null, { status: 416, headers });
    }
    const length = range.end - range.start + 1;
    const object = await env.AUDIO.get(key, {
      range: { offset: range.start, length },
    });
    if (!object) return new Response(null, { status: 404 });
    headers.set("Content-Length", String(length));
    headers.set(
      "Content-Range",
      `bytes ${range.start}-${range.end}/${stored.size}`,
    );
    return new Response(object.body, { status: 206, headers });
  }

  const object = await env.AUDIO.get(key);
  if (!object) return new Response(null, { status: 404 });
  headers.set("Content-Length", String(stored.size));
  return new Response(object.body, { status: 200, headers });
}

async function manageAudioObject(
  request: Request,
  env: Env,
  key: string,
): Promise<Response> {
  if (!uploadAuthorized(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (request.method === "HEAD") {
    const stored = await env.AUDIO.head(key);
    if (!stored) return new Response(null, { status: 404 });
    const headers = new Headers({
      "Content-Length": String(stored.size),
      ETag: stored.httpEtag,
    });
    const sha256 = stored.customMetadata?.sha256;
    if (sha256) headers.set("X-Content-SHA256", sha256);
    return new Response(null, { status: 200, headers });
  }

  if (request.method !== "PUT" || !request.body) {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const sha256 = request.headers.get("X-Content-SHA256")?.trim().toLowerCase();
  if (!sha256 || !/^[a-f0-9]{64}$/.test(sha256)) {
    return Response.json({ error: "Missing content hash" }, { status: 400 });
  }
  const contentType = request.headers.get("Content-Type") ||
    (key.endsWith(".json") ? "application/json; charset=utf-8" : "audio/mpeg");
  await env.AUDIO.put(key, request.body, {
    httpMetadata: {
      contentType,
      cacheControl: isMutableAudioObject(key)
        ? "no-store"
        : immutableAudioCache,
    },
    customMetadata: { sha256 },
  });
  return Response.json({ ok: true, key, sha256 });
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const adminAudioKey = audioObjectKey(url.pathname, audioAdminPrefix);
    if (adminAudioKey) {
      return manageAudioObject(request, env, adminAudioKey);
    }

    const publicAudioKey = audioObjectKey(url.pathname, publicAudioPrefix);
    if (publicAudioKey && ["GET", "HEAD"].includes(request.method)) {
      return serveAudioObject(request, env, publicAudioKey);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const response = await handler.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    const shouldAlwaysCheckForUpdates =
      request.method === "GET" &&
      (url.pathname === "/" ||
        url.pathname.startsWith("/content/") ||
        request.headers.get("RSC") === "1" ||
        request.headers.get("Accept")?.includes("text/html"));
    if (shouldAlwaysCheckForUpdates) {
      headers.set("Cache-Control", "no-store, max-age=0");
      headers.set("CDN-Cache-Control", "no-store");
    }
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    );
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};

export default worker;
