import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  acquireDirectoryLock,
  createSerializedJsonUpdater,
  parseJsonStream,
  retryTransient,
  runWorkerQueue,
  sentenceTimingsFromWords,
  writeJsonAtomic,
} from "./audio-controller.mjs";

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

test("serialized JSON updates do not lose concurrent progress", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "capital-audio-index-"));
  const file = path.join(directory, "index.json");
  try {
    await writeFile(file, '{"completed":0}\n', "utf8");
    const update = createSerializedJsonUpdater(file);
    await Promise.all(
      Array.from({ length: 30 }, () =>
        update((value) => {
          value.completed += 1;
        }),
      ),
    );
    const saved = JSON.parse(await readFile(file, "utf8"));
    assert.equal(saved.completed, 30);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("atomic JSON writes use independent temporary files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "capital-audio-atomic-"));
  const file = path.join(directory, "state.json");
  try {
    await writeJsonAtomic(file, { value: -1 });
    await Promise.all(
      Array.from({ length: 20 }, (_, value) =>
        writeJsonAtomic(file, { value }),
      ),
    );
    const saved = JSON.parse(await readFile(file, "utf8"));
    assert.ok(Number.isInteger(saved.value));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("transient server failures retry but client errors do not", async () => {
  let transientAttempts = 0;
  const result = await retryTransient(
    async () => {
      transientAttempts += 1;
      if (transientAttempts < 3) {
        const error = new Error("server closed the stream");
        error.status = 500;
        throw error;
      }
      return "ready";
    },
    { baseDelayMs: 0, sleep: async () => {} },
  );
  assert.equal(result, "ready");
  assert.equal(transientAttempts, 3);

  let clientAttempts = 0;
  await assert.rejects(
    retryTransient(
      async () => {
        clientAttempts += 1;
        const error = new Error("bad request");
        error.status = 400;
        throw error;
      },
      { baseDelayMs: 0, sleep: async () => {} },
    ),
    /bad request/,
  );
  assert.equal(clientAttempts, 1);
});

test("quota errors keep retrying beyond the old four-attempt limit", async () => {
  let attempts = 0;
  const result = await retryTransient(
    async () => {
      attempts += 1;
      if (attempts < 6) {
        const error = new Error("quota exceeded for types: concurrency");
        error.status = 429;
        throw error;
      }
      return "ready";
    },
    { baseDelayMs: 0, sleep: async () => {} },
  );
  assert.equal(result, "ready");
  assert.equal(attempts, 6);
});

test("generation directory lock serializes independent workers", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "capital-audio-lock-"));
  const lock = path.join(directory, "generation.lock");
  try {
    const releaseFirst = await acquireDirectoryLock(lock, {
      pollIntervalMs: 2,
      maximumWaitMs: 1_000,
    });
    let acquiredSecond = false;
    const second = acquireDirectoryLock(lock, {
      pollIntervalMs: 2,
      maximumWaitMs: 1_000,
    }).then((release) => {
      acquiredSecond = true;
      return release;
    });
    await wait(15);
    assert.equal(acquiredSecond, false);
    await releaseFirst();
    const releaseSecond = await second;
    assert.equal(acquiredSecond, true);
    await releaseSecond();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("worker queue waits for active workers before reporting failure", async () => {
  let active = 0;
  await assert.rejects(
    runWorkerQueue(3, 3, async (index) => {
      active += 1;
      try {
        await new Promise((resolve) => setTimeout(resolve, index === 0 ? 5 : 30));
        if (index === 0) throw new Error("chunk failed");
      } finally {
        active -= 1;
      }
    }),
    /chunk failed/,
  );
  assert.equal(active, 0);
});

test("HTTP TTS response parser accepts adjacent JSON objects", () => {
  const parsed = parseJsonStream(
    '\uFEFF{"code":0,"data":"YQ=="}\n{"code":20000000,"usage":{"text_words":1}}',
  );
  assert.deepEqual(parsed, [
    { code: 0, data: "YQ==" },
    { code: 20_000_000, usage: { text_words: 1 } },
  ]);
});

test("word timestamps are mapped back to source sentence ids", () => {
  const mapped = sentenceTimingsFromWords(
    [
      { id: "s0001", text: "第一句。" },
      { id: "s0002", text: "第二句。" },
    ],
    [
      {
        words: [
          { word: "第一句。", startTime: 0.1, endTime: 0.8 },
          { word: "第二句。", startTime: 0.9, endTime: 1.7 },
        ],
      },
    ],
    1.85,
  );
  assert.deepEqual(
    mapped.map(({ id, start_ms, end_ms, timing_source }) => ({
      id,
      start_ms,
      end_ms,
      timing_source,
    })),
    [
      {
        id: "s0001",
        start_ms: 100,
        end_ms: 800,
        timing_source: "provider_word_timestamps",
      },
      {
        id: "s0002",
        start_ms: 900,
        end_ms: 1700,
        timing_source: "provider_word_timestamps",
      },
    ],
  );
});
