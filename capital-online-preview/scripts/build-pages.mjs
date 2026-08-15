import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(appRoot, "public");
const stagingRoot = path.join(appRoot, ".pages-public");
const outputRoot = path.join(appRoot, "pages-dist");

await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });

await Promise.all([
  cp(path.join(publicRoot, "assets"), path.join(stagingRoot, "assets"), {
    recursive: true,
  }),
  cp(path.join(publicRoot, "content"), path.join(stagingRoot, "content"), {
    recursive: true,
  }),
  cp(path.join(publicRoot, "favicon.svg"), path.join(stagingRoot, "favicon.svg")),
  cp(
    path.join(publicRoot, "reader-social-card.png"),
    path.join(stagingRoot, "reader-social-card.png"),
  ),
]);

await build({
  configFile: path.join(appRoot, "vite.pages.config.ts"),
});

await writeFile(path.join(outputRoot, ".nojekyll"), "", "utf8");
await rm(stagingRoot, { recursive: true, force: true });

console.log("GitHub Pages 静态阅读版已生成（不含语音与服务端功能）。");
