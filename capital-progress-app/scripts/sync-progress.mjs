import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createProgressState,
  DEFAULT_PROJECT_ROOT,
} from "./progress-state.mjs";

const root = process.cwd();
const projectRoot = path.resolve(
  process.env.CAPITAL_PROJECT_ROOT || process.argv[2] || DEFAULT_PROJECT_ROOT
);
const state = await createProgressState(projectRoot);

await writeFile(
  path.join(root, "data", "progress.json"),
  JSON.stringify(state, null, 2) + "\n",
  "utf8"
);

console.log(
  `已生成本地快照：${state.book.partCount} 篇，${state.book.chapterCount} 章，${state.book.completedUnitCount} 节已完成`
);
