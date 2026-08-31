import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const appRoot = new URL("../", import.meta.url);

test("GitHub Pages build is a self-contained reading snapshot without audio", async () => {
  await access(new URL("pages-dist/index.html", appRoot));
  await access(new URL("pages-dist/content/ch01-s01.json", appRoot));
  const pdf = await readFile(
    new URL("pages-dist/downloads/capital-volume1-modern-chinese.pdf", appRoot),
  );
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(pdf.length > 1_000_000);

  await assert.rejects(access(new URL("pages-dist/audio", appRoot)));

  const [entry, reader, html, assetNames] = await Promise.all([
    readFile(new URL("pages/main.tsx", appRoot), "utf8"),
    readFile(new URL("app/ReaderApp.tsx", appRoot), "utf8"),
    readFile(new URL("pages-dist/index.html", appRoot), "utf8"),
    readdir(new URL("pages-dist/assets/", appRoot)),
  ]);

  assert.match(entry, /analytics:\s*false/);
  assert.match(entry, /audio:\s*false/);
  assert.match(entry, /notes:\s*false/);
  assert.match(
    entry,
    /pdfDownloadHref:\s*`\$\{import\.meta\.env\.BASE_URL\}downloads\/capital-volume1-modern-chinese\.pdf`/,
  );
  assert.match(reader, /audioEnabled && !loading/);
  assert.match(reader, /notesEnabled \? \(/);
  assert.match(reader, /aria-label="在新标签页打开全书 PDF"/);
  assert.match(reader, /target="_blank"/);
  assert.match(html, /\/capital-de-zh\/assets\//);
  const javascript = (
    await Promise.all(
      assetNames
        .filter((name) => name.endsWith(".js"))
        .map((name) =>
          readFile(new URL(`pages-dist/assets/${name}`, appRoot), "utf8"),
        ),
    )
  ).join("\n");
  assert.match(
    javascript,
    /\/capital-de-zh\/downloads\/capital-volume1-modern-chinese\.pdf/,
  );
});
