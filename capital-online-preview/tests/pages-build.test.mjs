import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const appRoot = new URL("../", import.meta.url);

test("GitHub Pages build is a self-contained reading snapshot without audio", async () => {
  await access(new URL("pages-dist/index.html", appRoot));
  await access(new URL("pages-dist/content/ch01-s01.json", appRoot));

  await assert.rejects(access(new URL("pages-dist/audio", appRoot)));

  const [entry, reader, html] = await Promise.all([
    readFile(new URL("pages/main.tsx", appRoot), "utf8"),
    readFile(new URL("app/ReaderApp.tsx", appRoot), "utf8"),
    readFile(new URL("pages-dist/index.html", appRoot), "utf8"),
  ]);

  assert.match(entry, /features=\{\{ analytics: false, audio: false, notes: false \}\}/);
  assert.match(reader, /audioEnabled && !loading/);
  assert.match(reader, /notesEnabled \? \(/);
  assert.match(html, /\/capital-de-zh\/assets\//);
});
