import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const sync = spawnSync(
  process.execPath,
  [path.join(root, "scripts", "sync-progress.mjs")],
  { cwd: root, encoding: "utf8" }
);
if (sync.status !== 0) {
  process.stderr.write(sync.stderr || sync.stdout);
  process.exit(sync.status || 1);
}

await rm(path.join(root, "dist"), { recursive: true, force: true });
await mkdir(path.join(root, "dist", "public"), { recursive: true });
await mkdir(path.join(root, "dist", "scripts"), { recursive: true });
await mkdir(path.join(root, "dist", "data"), { recursive: true });
await cp(
  path.join(root, "public", "index.html"),
  path.join(root, "dist", "public", "index.html")
);
await cp(
  path.join(root, "scripts", "dev.mjs"),
  path.join(root, "dist", "scripts", "dev.mjs")
);
await cp(
  path.join(root, "scripts", "progress-state.mjs"),
  path.join(root, "dist", "scripts", "progress-state.mjs")
);
await cp(
  path.join(root, "scripts", "adoption-state.mjs"),
  path.join(root, "dist", "scripts", "adoption-state.mjs")
);
for (const file of [
  "audio-adoption-state.mjs",
  "audio-files.mjs",
  "audio-generation-queue.mjs",
  "audio-publish.mjs",
  "publish-adopted-audio.mjs",
]) {
  await cp(
    path.join(root, "scripts", file),
    path.join(root, "dist", "scripts", file)
  );
}
await cp(
  path.join(root, "data", "progress.json"),
  path.join(root, "dist", "data", "progress.json")
);

console.log("本地应用构建完成");
