import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  loadAudioPublishConfig,
  publishAdoptedAudio,
} from "./audio-publish.mjs";
import { DEFAULT_PROJECT_ROOT } from "./progress-state.mjs";

const appRoot = process.cwd();
const projectRoot = path.resolve(
  process.env.CAPITAL_PROJECT_ROOT || process.argv[2] || DEFAULT_PROJECT_ROOT,
);
const config = await loadAudioPublishConfig(appRoot);
if (!config) throw new Error("预览站语音发布尚未配置");

const adoptions = JSON.parse(
  await readFile(path.join(projectRoot, "audio", "adoptions.json"), "utf8"),
);
const audioVersionIds = [...new Set(Object.values(adoptions))];
let completed = 0;
for (const audioVersionId of audioVersionIds) {
  process.stdout.write(`同步 ${audioVersionId}... `);
  try {
    await publishAdoptedAudio({ projectRoot, config, audioVersionId });
    completed += 1;
    process.stdout.write("完成\n");
  } catch (error) {
    process.stdout.write(
      `失败：${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}
console.log(`已同步 ${completed}/${audioVersionIds.length} 个采用中的语音版本。`);
