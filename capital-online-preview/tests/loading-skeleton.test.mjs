import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appRoot = new URL("../", import.meta.url);

test("正文加载使用可访问的骨架屏", async () => {
  const [reader, css] = await Promise.all([
    readFile(new URL("app/ReaderApp.tsx", appRoot), "utf8"),
    readFile(new URL("app/globals.css", appRoot), "utf8"),
  ]);

  assert.match(reader, /readingSkeletonParagraphs/);
  assert.match(reader, /className="reading-skeleton"/);
  assert.match(reader, /aria-live="polite"/);
  assert.match(reader, /className="sr-only">正在载入正文/);
  assert.match(css, /\.reading-skeleton-line/);
  assert.match(css, /@keyframes reading-skeleton-shimmer/);
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.reading-skeleton-line\s*\{[\s\S]*animation:\s*none/,
  );
});
