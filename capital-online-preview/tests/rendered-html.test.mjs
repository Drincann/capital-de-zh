import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const appRoot = new URL("../", import.meta.url);
const projectRoot = new URL(
  "../../outputs/capital-volume1-de-zh-new/",
  import.meta.url,
);

test("公开页面只呈现阅读界面", async () => {
  const [reader, layout, worker] = await Promise.all([
    readFile(new URL("app/ReaderApp.tsx", appRoot), "utf8"),
    readFile(new URL("app/layout.tsx", appRoot), "utf8"),
    readFile(new URL("worker/index.ts", appRoot), "utf8"),
  ]);
  assert.match(layout, /《资本论》第一卷/);
  assert.match(reader, /release\.editionTitle/);
  assert.match(reader, /目录/);
  assert.match(reader, /cache:\s*"no-store"/);
  assert.doesNotMatch(reader, /cache:\s*"force-cache"/);
  assert.match(worker, /Referrer-Policy", "no-referrer"/);
  assert.match(worker, /shouldAlwaysCheckForUpdates/);
  assert.match(worker, /Cache-Control", "no-store, max-age=0"/);
  assert.match(worker, /CDN-Cache-Control", "no-store"/);
  assert.doesNotMatch(
    reader,
    /采用此版本|已采用|等待审核|翻译控制|任务状态|初译|返工|versionId\.replace/,
  );
});

test("划词笔记公开可读，只有指定 ChatGPT 账号可写", async () => {
  const [page, readerNotes, notesRoute, notesAuth, schema, css] =
    await Promise.all([
      readFile(new URL("app/page.tsx", appRoot), "utf8"),
      readFile(new URL("app/ReaderNotes.tsx", appRoot), "utf8"),
      readFile(new URL("app/api/notes/route.ts", appRoot), "utf8"),
      readFile(new URL("lib/notes-auth.ts", appRoot), "utf8"),
      readFile(new URL("db/schema.ts", appRoot), "utf8"),
      readFile(new URL("app/globals.css", appRoot), "utf8"),
    ]);

  assert.match(page, /getChatGPTUser/);
  assert.match(page, /notesOwnerEmail/);
  assert.match(notesAuth, /user\.email\.toLowerCase\(\) !== ownerEmail/);
  assert.match(notesRoute, /export async function GET/);
  assert.match(notesRoute, /export async function POST/);
  assert.match(notesRoute, /export async function PATCH/);
  assert.match(notesRoute, /export async function DELETE/);
  assert.match(notesRoute, /getNotesEditor/);
  assert.match(notesRoute, /owner_email = \?/);
  assert.match(schema, /readerNotes/);
  assert.match(schema, /reader_notes_section_idx/);
  assert.match(readerNotes, /captureSelection/);
  assert.match(readerNotes, /applyHighlights/);
  assert.match(readerNotes, /saveQueue/);
  assert.match(readerNotes, /使用 ChatGPT 登录/);
  assert.match(css, /\.reader-note-highlight/);
  assert.match(css, /\.notes-panel/);
  assert.doesNotMatch(
    `${page}\n${readerNotes}\n${notesRoute}`,
    /["'][^"'\s]+@[^"'\s]+["']/i,
  );
});

test("发布快照只包含正式采用的版本", async () => {
  const [manifest, adoptions, contentFiles] = await Promise.all([
    readFile(new URL("generated/release-manifest.json", appRoot), "utf8").then(
      JSON.parse,
    ),
    readFile(
      new URL("manifests/adoptions.json", projectRoot),
      "utf8",
    ).then(JSON.parse),
    readdir(new URL("public/content/", appRoot)),
  ]);

  const sections = manifest.parts.flatMap((part) =>
    part.chapters.flatMap((chapter) => chapter.sections),
  );
  const chapters = manifest.parts.flatMap((part) => part.chapters);
  const upcomingChapters = chapters.filter((chapter) => !chapter.available);
  assert.equal(sections.length, manifest.sectionCount);
  assert.equal(chapters.length, manifest.chapterCount);
  assert.ok(upcomingChapters.length > 0);
  assert.ok(upcomingChapters.every((chapter) => chapter.sections.length === 0));
  assert.equal(
    contentFiles.length,
    manifest.sectionCount + (manifest.preface ? 1 : 0),
  );
  assert.ok(sections.length > 0);

  assert.equal(manifest.preface?.title, "译者序");
  const preface = JSON.parse(
    await readFile(new URL("public/content/translator-preface.json", appRoot)),
  );
  assert.equal(preface.unitId, manifest.preface.id);
  assert.match(preface.html, /答案有时走在问题前面/);

  for (const section of sections) {
    assert.equal(section.versionId, adoptions[section.id]);
    assert.match(section.contentPath, /^\/content\/[a-z0-9-]+\.json$/i);
    const content = JSON.parse(
      await readFile(
        new URL(section.contentPath.replace(/^\//, "public/"), appRoot),
        "utf8",
      ),
    );
    assert.equal(content.unitId, section.id);
    assert.equal(content.versionId, section.versionId);
    assert.ok(content.html.length > 0);
  }

  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(
    serialized,
    /artifact_path|review|task|status|adoption|source_path/i,
  );
});

test("统计数据库不保存访问明细和原始环境信息", async () => {
  const [schema, analytics] = await Promise.all([
    readFile(new URL("db/schema.ts", appRoot), "utf8"),
    readFile(new URL("lib/analytics.ts", appRoot), "utf8"),
  ]);

  assert.match(schema, /analytics_daily_metrics/);
  assert.match(schema, /analytics_daily_visitors/);
  assert.doesNotMatch(
    schema,
    /ip_address|user_agent|referrer|query_string|path_name|latitude|longitude/i,
  );
  assert.match(analytics, /HMAC/);
  assert.match(analytics, /fingerprintHash/);
  assert.doesNotMatch(analytics, /INSERT INTO analytics_events/i);
});

test("目录收起和脚注跳转保留稳定布局与明确反馈", async () => {
  const [reader, css] = await Promise.all([
    readFile(new URL("app/ReaderApp.tsx", appRoot), "utf8"),
    readFile(new URL("app/globals.css", appRoot), "utf8"),
  ]);

  assert.match(reader, /github\.com\/Drincann\/capital-de-zh/);
  assert.match(reader, /scrollIntoView\(\{/);
  assert.match(reader, /block:\s*"center"/);
  assert.match(reader, /footnote-pulse/);
  assert.match(reader, /querySelectorAll<HTMLElement>\(\s*"#reading-content \.prose p"/s);
  assert.match(reader, /scrollToParagraph/);
  assert.match(reader, /paragraph-marker/);
  assert.match(reader, /in-viewport/);
  assert.match(reader, /catalog-chapter-upcoming/);
  assert.match(reader, /本章尚未完成翻译，完成后将在这里开放/);
  assert.match(reader, /aria-disabled/);
  assert.match(css, /\.reading-pane\s*\{[^}]*grid-column:\s*2/s);
  assert.match(css, /\.footnotes-list\s*\{[^}]*list-style:\s*decimal/s);
  assert.match(css, /html\s*\{[^}]*scrollbar-width:\s*none/s);
  assert.doesNotMatch(
    css,
    /\.catalog-collapsed \.catalog\s*\{\s*display:\s*none/s,
  );
});

test("dark theme is applied before first paint and footnote feedback waits for scrolling", async () => {
  const [layout, reader, css] = await Promise.all([
    readFile(new URL("app/layout.tsx", appRoot), "utf8"),
    readFile(new URL("app/ReaderApp.tsx", appRoot), "utf8"),
    readFile(new URL("app/globals.css", appRoot), "utf8"),
  ]);

  assert.match(layout, /themeBootstrapScript/);
  assert.match(layout, /document\.documentElement\.dataset\.readerTheme/);
  assert.match(layout, /suppressHydrationWarning/);
  assert.match(css, /:root\[data-reader-theme="dark"\]/);
  assert.match(reader, /addEventListener\("scrollend", showHighlight/);
  assert.match(reader, /offsetWidth/);
  assert.match(reader, /readingPosition\.current/);
  assert.match(reader, /paragraphMarkers/);
  assert.match(reader, /paragraph-tooltip/);
  assert.match(reader, /--paragraph-hit-start/);
  assert.match(reader, /--paragraph-hit-size/);
  assert.match(reader, /locationResolved/);
  assert.match(reader, /capital-reader-position/);
  assert.match(reader, /sessionStorage\.setItem\(readingPositionKey/);
  assert.match(reader, /sessionStorage\.removeItem\(readingPositionKey/);
  assert.match(reader, /position\.sectionId !== sectionId/);
  assert.match(reader, /position\.scrollY <= 1/);
  assert.match(reader, /saveReadingPosition/);
  assert.match(reader, /restoreReadingPosition/);
  assert.match(reader, /offsetRatio/);
  assert.doesNotMatch(reader, /setScrollProgress|setPageScrollable/);
  assert.doesNotMatch(reader, /scrollToReadingProgress|reading-position-viewport/);
  assert.doesNotMatch(
    reader,
    /<span className="paragraph-tooltip"[^>]*>\s*<strong>/,
  );
  assert.match(css, /\.paragraph-marker\.in-viewport \.paragraph-line/);
  assert.match(css, /\.paragraph-marker:hover \.paragraph-line/);
  assert.match(css, /\.paragraph-tooltip/);
  assert.doesNotMatch(css, /inset\s+3px\s+0\s+0\s+var\(--accent\)/);
});
