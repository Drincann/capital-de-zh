import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  applyAudioQueueState,
  createAudioGenerationQueue,
  directNetworkEnvironment,
} from "../scripts/audio-generation-queue.mjs";

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("audio jobs run one at a time and duplicate clicks do not add jobs", async () => {
  const children = [];
  const environment = {
    PATH: "kept",
    HTTP_PROXY: "http://proxy.example:8080",
    https_proxy: "http://proxy.example:8080",
    ALL_PROXY: "socks://proxy.example:1080",
    NODE_USE_ENV_PROXY: "1",
    GLOBAL_AGENT_HTTP_PROXY: "http://proxy.example:8080",
  };
  const queue = createAudioGenerationQueue({
    controller: "controller.mjs",
    cwd: ".",
    environment,
    spawnProcess: (_command, arguments_, options) => {
      const child = new EventEmitter();
      child.pid = 4000 + children.length;
      child.arguments = arguments_;
      child.options = options;
      children.push(child);
      return child;
    },
  });

  assert.equal(queue.enqueue("ch01-s01", "seed-audio-1.0").status, "generating");
  assert.equal(queue.enqueue("ch14-s01", "seed-tts-2.0").status, "queued");
  assert.equal(queue.enqueue("ch14-s01", "seed-tts-2.0").duplicate, true);
  assert.equal(queue.enqueue("ch14-s01", "seed-audio-1.0").duplicate, false);
  assert.equal(children.length, 1);
  assert.equal(queue.snapshot().active.unitId, "ch01-s01");
  assert.equal(queue.snapshot().waiting[0].unitId, "ch14-s01");
  assert.equal(queue.snapshot().waiting[0].modelId, "seed-tts-2.0");
  assert.equal(children[0].options.env.PATH, "kept");
  assert.equal(children[0].options.env.NO_PROXY, "*");
  assert.equal(children[0].options.env.HTTP_PROXY, undefined);
  assert.equal(children[0].options.env.https_proxy, undefined);
  assert.equal(children[0].options.env.ALL_PROXY, undefined);
  assert.equal(children[0].options.env.NODE_USE_ENV_PROXY, undefined);
  assert.equal(children[0].options.env.GLOBAL_AGENT_HTTP_PROXY, undefined);

  children[0].emit("exit", 0);
  await nextTurn();
  assert.equal(children.length, 2);
  assert.equal(queue.snapshot().active.unitId, "ch14-s01");
  assert.deepEqual(children[1].arguments, [
    "controller.mjs",
    "generate",
    "--unit",
    "ch14-s01",
    "--model",
    "seed-tts-2.0",
  ]);
});

test("direct TTS environment removes proxy variables case-insensitively", () => {
  const environment = directNetworkEnvironment({
    Https_Proxy: "http://proxy.example:8080",
    npm_config_proxy: "http://proxy.example:8080",
    HOME: "kept",
  });
  assert.deepEqual(environment, { HOME: "kept", NO_PROXY: "*" });
});

test("a speech correction queues one patch command with the selected sentence", async () => {
  const children = [];
  const queue = createAudioGenerationQueue({
    controller: "controller.mjs",
    cwd: ".",
    spawnProcess: (_command, arguments_) => {
      const child = new EventEmitter();
      child.pid = 5100;
      child.arguments = arguments_;
      children.push(child);
      return child;
    },
  });
  const result = queue.enqueuePatch({
    unitId: "ch08-s01",
    modelId: "seed-audio-1.0",
    baseAudioVersionId: "audio-v1",
    sentenceId: "ch08-s01-n0013",
    speechText: "百分之十六又三分之二。",
  });
  assert.equal(result.status, "generating");
  assert.equal(queue.snapshot().active.operation, "patch");
  assert.deepEqual(children[0].arguments, [
    "controller.mjs",
    "patch",
    "--unit",
    "ch08-s01",
    "--model",
    "seed-audio-1.0",
    "--base-audio-version",
    "audio-v1",
    "--sentence",
    "ch08-s01-n0013",
    "--speech-text",
    "百分之十六又三分之二。",
  ]);
});

test("queue state is visible on the adopted version", () => {
  const state = {
    frontMatter: [],
    parts: [
      {
        chapters: [
          {
            sections: [
              {
                unit_id: "ch14-s01",
                adoptedVersionId: "ch14-s01-v1",
                audio: {
                  status: "failed",
                  canGenerate: true,
                  models: [
                    {
                      id: "seed-tts-2.0",
                      status: "failed",
                      canGenerate: true,
                    },
                  ],
                },
                versions: [
                  {
                    id: "ch14-s01-v1",
                    audio: {
                      status: "failed",
                      canGenerate: true,
                      models: [
                        {
                          id: "seed-tts-2.0",
                          status: "failed",
                          canGenerate: true,
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  applyAudioQueueState(state, {
    active: null,
    waiting: [
      { unitId: "ch14-s01", modelId: "seed-tts-2.0", position: 1 },
    ],
  });
  const unit = state.parts[0].chapters[0].sections[0];
  assert.equal(unit.audio.status, "queued");
  assert.equal(unit.audio.canGenerate, false);
  assert.equal(unit.versions[0].audio.status, "queued");
  assert.equal(unit.audio.models[0].status, "queued");
});

test("a failed speech correction exposes its error in queue state", async () => {
  let child;
  const queue = createAudioGenerationQueue({
    controller: "controller.mjs",
    cwd: ".",
    spawnProcess: () => {
      child = new EventEmitter();
      child.pid = 5200;
      child.stderr = new PassThrough();
      return child;
    },
  });
  queue.enqueuePatch({
    unitId: "ch08-s01",
    modelId: "seed-audio-1.0",
    baseAudioVersionId: "audio-v1",
    sentenceId: "ch08-s01-n0013",
    speechText: "百分之十六又三分之二。",
  });
  child.stderr.write("Error: 基础语音版本不兼容\n");
  child.emit("exit", 1);
  await nextTurn();

  const failure = queue.snapshot().failures[0];
  assert.equal(failure.status, "failed");
  assert.equal(failure.operation, "patch");
  assert.equal(failure.error, "Error: 基础语音版本不兼容");

  const state = {
    frontMatter: [],
    parts: [
      {
        chapters: [
          {
            sections: [
              {
                unit_id: "ch08-s01",
                adoptedVersionId: "ch08-s01-v1",
                audio: {
                  status: "ready",
                  models: [{ id: "seed-audio-1.0", canGenerate: false }],
                },
                versions: [
                  {
                    id: "ch08-s01-v1",
                    audio: {
                      status: "ready",
                      models: [{ id: "seed-audio-1.0", canGenerate: false }],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  applyAudioQueueState(state, queue.snapshot());
  const audio = state.parts[0].chapters[0].sections[0].audio;
  assert.equal(audio.generation.status, "failed");
  assert.equal(audio.generation.operation, "patch");
  assert.equal(audio.generation.error, "Error: 基础语音版本不兼容");
  assert.equal(audio.models[0].canGenerate, false);
});

test("a failed generation keeps the model name and provider error", async () => {
  let child;
  const queue = createAudioGenerationQueue({
    controller: "controller.mjs",
    cwd: ".",
    spawnProcess: () => {
      child = new EventEmitter();
      child.pid = 5300;
      child.stderr = new PassThrough();
      return child;
    },
  });
  queue.enqueue("ch01-s01", "seed-audio-1.0");
  child.stderr.write("Error: c0004 生成失败：HTTP 403 requested resource not granted\n");
  child.stderr.write("    at generateChunk (controller.mjs:1:1)\n");
  child.stderr.write("Node.js v20.20.0\n");
  child.emit("exit", 1);
  await nextTurn();

  const state = {
    frontMatter: [],
    parts: [
      {
        chapters: [
          {
            sections: [
              {
                unit_id: "ch01-s01",
                adoptedVersionId: "ch01-s01-v10",
                audio: {
                  status: "failed",
                  error: "c0004 生成失败：HTTP 403 requested resource not granted",
                  models: [
                    {
                      id: "seed-audio-1.0",
                      label: "现有模型 1.0",
                      status: "failed",
                      error: "c0004 生成失败：HTTP 403 requested resource not granted",
                      canGenerate: true,
                    },
                  ],
                },
                versions: [{ id: "ch01-s01-v10" }],
              },
            ],
          },
        ],
      },
    ],
  };
  applyAudioQueueState(state, queue.snapshot());
  const audio = state.parts[0].chapters[0].sections[0].audio;
  assert.equal(audio.models[0].label, "现有模型 1.0");
  assert.equal(
    audio.models[0].error,
    "c0004 生成失败：HTTP 403 requested resource not granted"
  );
  assert.equal(
    audio.generation.error,
    "c0004 生成失败：HTTP 403 requested resource not granted"
  );
  assert.equal(
    audio.error,
    "c0004 生成失败：HTTP 403 requested resource not granted"
  );
});
