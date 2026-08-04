import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { publishAdoptedAudio } from "../scripts/audio-publish.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");

test("publishing adopted audio uploads immutable files then activates the registry", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capital-audio-publish-"));
  try {
    const versionId = "unit-a-v1";
    const audioVersionId = "unit-a-v1-audio-test";
    const translationSha256 = "a".repeat(64);
    const audioDirectory = path.join(root, "audio", "versions", audioVersionId);
    await mkdir(path.join(root, "manifests"), { recursive: true });
    await mkdir(audioDirectory, { recursive: true });
    await writeFile(
      path.join(root, "manifests", "adoptions.json"),
      JSON.stringify({ "unit-a": versionId }),
    );
    await writeFile(
      path.join(root, "audio", "adoptions.json"),
      JSON.stringify({ [versionId]: audioVersionId }),
    );
    await writeFile(
      path.join(root, "audio", "index.json"),
      JSON.stringify({
        audio_versions: [
          {
            audio_version_id: audioVersionId,
            unit_id: "unit-a",
            translation_version_id: versionId,
            translation_sha256: translationSha256,
            status: "ready",
            manifest_path: `audio/versions/${audioVersionId}/manifest.json`,
          },
        ],
      }),
    );
    const chunk = Buffer.from("test audio bytes");
    const manifest = {
      status: "ready",
      audio_version_id: audioVersionId,
      unit_id: "unit-a",
      translation_version_id: versionId,
      translation_sha256: translationSha256,
      chunks: [{ id: "c0001", audio_file: "c0001.mp3" }],
      sentences: [],
    };
    await writeFile(path.join(audioDirectory, "c0001.mp3"), chunk);
    await writeFile(
      path.join(audioDirectory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    const objects = new Map();
    const putCounts = new Map();
    const fetchImpl = async (url, options = {}) => {
      const key = decodeURIComponent(new URL(url).pathname.split("/api/audio-assets/")[1]);
      if (options.method === "HEAD") {
        const stored = objects.get(key);
        return stored
          ? new Response(null, {
              status: 200,
              headers: { "x-content-sha256": stored.sha256 },
            })
          : new Response(null, { status: 404 });
      }
      assert.equal(options.method, "PUT");
      const bytes = Buffer.from(options.body);
      const sha256 = options.headers["X-Content-SHA256"];
      assert.equal(digest(bytes), sha256);
      objects.set(key, { bytes, sha256 });
      putCounts.set(key, (putCounts.get(key) || 0) + 1);
      return Response.json({ ok: true });
    };
    const config = { origin: "https://reader.example", token: "secret" };
    const progress = [];
    await publishAdoptedAudio({
      projectRoot: root,
      config,
      audioVersionId,
      fetchImpl,
      onProgress: (value) => progress.push(value),
    });

    const chunkKey = [...objects.keys()].find((key) =>
      key.startsWith(`${audioVersionId}/chunks/`),
    );
    const manifestKey = [...objects.keys()].find((key) =>
      key.startsWith(`${audioVersionId}/manifest-`),
    );
    assert.ok(chunkKey);
    assert.ok(manifestKey);
    assert.ok(objects.has("adoptions.json"));
    const registry = JSON.parse(objects.get("adoptions.json").bytes.toString());
    assert.equal(registry.adoptions[versionId].audio_version_id, audioVersionId);
    assert.equal(
      registry.adoptions[versionId].manifest_path,
      `/audio/${manifestKey}`,
    );
    assert.equal(progress.at(-1).completedFiles, 2);
    const publications = JSON.parse(
      await readFile(path.join(root, "audio", "publications.json"), "utf8"),
    );
    assert.equal(publications.audio_versions[audioVersionId].status, "published");
    assert.equal(publications.audio_versions[audioVersionId].completed_files, 2);
    assert.equal(
      publications.audio_versions[audioVersionId].completed_bytes,
      chunk.length + objects.get(manifestKey).bytes.length,
    );
    assert.equal(publications.adoptions[versionId], audioVersionId);

    publications.audio_versions[audioVersionId].status = "failed";
    publications.audio_versions[audioVersionId].error = "temporary network failure";
    await writeFile(
      path.join(root, "audio", "publications.json"),
      JSON.stringify(publications),
    );

    await publishAdoptedAudio({
      projectRoot: root,
      config,
      audioVersionId,
      fetchImpl,
    });
    assert.equal(putCounts.get(chunkKey), 1);
    assert.equal(putCounts.get(manifestKey), 1);
    assert.equal(putCounts.get("adoptions.json"), 2);
    const restoredRegistry = JSON.parse(
      objects.get("adoptions.json").bytes.toString(),
    );
    assert.equal(
      restoredRegistry.adoptions[versionId].audio_version_id,
      audioVersionId,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
