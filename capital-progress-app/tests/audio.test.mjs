import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { handleAudioRequest } from "../scripts/audio-files.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const projectRoot = path.join(repoRoot, "outputs", "capital-volume1-de-zh-new");

test("ready audio exposes a version-bound manifest and byte ranges", async () => {
  const index = JSON.parse(
    await readFile(path.join(projectRoot, "audio", "index.json"), "utf8"),
  );
  const record = index.audio_versions.find(
    (item) => item.unit_id === "ch05-s01" && item.status === "ready",
  );
  assert.ok(record, "ch05-s01 ready audio fixture is required");

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (
      !(await handleAudioRequest(request, response, url, {
        projectRoot,
        repoRoot,
      }))
    ) {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    const manifestResponse = await fetch(
      `${origin}/api/audio/manifest/${record.audio_version_id}`,
    );
    assert.equal(manifestResponse.status, 200);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.translation_version_id, record.translation_version_id);
    assert.equal(manifest.translation_sha256, record.translation_sha256);
    assert.equal(manifest.chunks.length, 26);
    assert.equal(manifest.sentences.length, 156);
    assert.equal(manifest.sentences[0].paragraph_index, 0);
    assert.match(manifest.chunks[0].audio_file, /^\/api\/audio\/file\//);

    const audioResponse = await fetch(
      `${origin}${manifest.chunks[0].audio_file}`,
      { headers: { range: "bytes=0-99" } },
    );
    assert.equal(audioResponse.status, 206);
    assert.equal(audioResponse.headers.get("accept-ranges"), "bytes");
    assert.match(audioResponse.headers.get("content-range"), /^bytes 0-99\//);
    assert.equal((await audioResponse.arrayBuffer()).byteLength, 100);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
