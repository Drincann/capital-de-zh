import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  applyAudioQueueState,
  createAudioGenerationQueue,
} from "../scripts/audio-generation-queue.mjs";

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("audio jobs run one at a time and duplicate clicks do not add jobs", async () => {
  const children = [];
  const queue = createAudioGenerationQueue({
    controller: "controller.mjs",
    cwd: ".",
    spawnProcess: (_command, arguments_) => {
      const child = new EventEmitter();
      child.pid = 4000 + children.length;
      child.arguments = arguments_;
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
