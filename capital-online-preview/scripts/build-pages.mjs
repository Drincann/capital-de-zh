import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(appRoot, "public");
const stagingRoot = path.join(appRoot, ".pages-public");
const outputRoot = path.join(appRoot, "pages-dist");
const pdfFileName = "capital-volume1-modern-chinese.pdf";
const pdfOutputPath = path.join(stagingRoot, "downloads", pdfFileName);

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

await mkdir(path.dirname(pdfOutputPath), { recursive: true });
const pdfResult = spawnSync(
  process.execPath,
  [path.join(appRoot, "scripts", "build-book-pdf.mjs"), "--output", pdfOutputPath],
  { cwd: appRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
);
if (pdfResult.status !== 0) {
  throw new Error(
    `PDF generation failed (${pdfResult.status}).\n${pdfResult.stdout || ""}\n${pdfResult.stderr || ""}`,
  );
}

await build({
  configFile: path.join(appRoot, "vite.pages.config.ts"),
});

await writeFile(path.join(outputRoot, ".nojekyll"), "", "utf8");
await rm(stagingRoot, { recursive: true, force: true });

console.log("GitHub Pages 静态阅读版与全书 PDF 已生成（不含语音与服务端功能）。");
