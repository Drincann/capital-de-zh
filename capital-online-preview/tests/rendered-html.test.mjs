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
  assert.match(reader, /ChatGPT 译/);
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
  assert.match(readerNotes, /调整笔记栏宽度/);
  assert.match(readerNotes, /调整笔记编辑框高度/);
  assert.match(readerNotes, /capital-reader-notes-width/);
  assert.match(readerNotes, /capital-reader-note-editor-height/);
  assert.match(css, /\.reader-note-highlight/);
  assert.match(css, /\.notes-panel/);
  assert.match(css, /\.notes-panel-resizer/);
  assert.match(css, /\.note-textarea-resizer/);
  assert.match(css, /\.note-editor textarea\s*\{[^}]*resize:\s*none/s);
  assert.match(css, /\.note-editor textarea\s*\{[^}]*appearance:\s*none/s);
  assert.doesNotMatch(css, /\.note-card(?:(?:\[[^\]]+\])?)::before/);
  assert.doesNotMatch(css, /\.note-card\s*\{[^}]*border-left\s*:/s);
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
  assert.match(preface.html, /class="translator-signature"/);
  assert.match(preface.html, /<strong>ChatGPT<\/strong>/);
  assert.match(preface.html, /datetime="2026-07">2026年7月/);

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

test("语音只随完全匹配的采用版本发布", async () => {
  const [manifest, audioIndex] = await Promise.all([
    readFile(new URL("generated/release-manifest.json", appRoot), "utf8").then(
      JSON.parse,
    ),
    readFile(new URL("audio/index.json", projectRoot), "utf8").then(JSON.parse),
  ]);
  const sections = manifest.parts.flatMap((part) =>
    part.chapters.flatMap((chapter) => chapter.sections),
  );
  const voiced = sections.filter((section) => section.audioManifestPath);
  assert.ok(voiced.length > 0);

  for (const section of voiced) {
    const content = JSON.parse(
      await readFile(
        new URL(section.contentPath.replace(/^\//, "public/"), appRoot),
        "utf8",
      ),
    );
    const audio = JSON.parse(
      await readFile(
        new URL(section.audioManifestPath.replace(/^\//, "public/"), appRoot),
        "utf8",
      ),
    );
    const record = audioIndex.audio_versions.find(
      (item) => item.audio_version_id === audio.audio_version_id,
    );
    assert.equal(audio.status, "ready");
    assert.equal(audio.unit_id, section.id);
    assert.equal(audio.translation_version_id, section.versionId);
    assert.equal(audio.translation_sha256, content.translationSha256);
    assert.equal(record.status, "ready");
    assert.equal(content.audioManifestPath, section.audioManifestPath);
    assert.ok(content.sentences.length > 0);
    assert.equal(audio.sentences.length, content.sentences.length);
  }
});

test("语音阅读支持逐句定位、按需加载和移动端控制", async () => {
  const [reader, audioReader, css] = await Promise.all([
    readFile(new URL("app/ReaderApp.tsx", appRoot), "utf8"),
    readFile(new URL("app/AudioReader.tsx", appRoot), "utf8"),
    readFile(new URL("app/globals.css", appRoot), "utf8"),
  ]);
  assert.match(reader, /<AudioReader/);
  assert.match(audioReader, /data-narration-sentence/);
  assert.match(audioReader, /preload="metadata"/);
  assert.match(audioReader, /rel = "prefetch"/);
  assert.match(audioReader, /translation_sha256 !== translationSha256/);
  assert.match(audioReader, /mediaSession/);
  assert.match(audioReader, /playbackRate/);
  assert.match(audioReader, /narration-play-icon/);
  assert.doesNotMatch(audioReader, /Ⅱ/);
  assert.match(css, /\.narration-current/);
  assert.match(css, /\.narration-play-icon\.is-pause span/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.reading-pane:has\(\.narration-player\)/);
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

test("inline and display formulas are rendered instead of exposed as TeX", async () => {
  const [surplusRate, workingDay, relativeSurplusValue, mathCss, mainFont] =
    await Promise.all([
      readFile(new URL("public/content/ch07-s02.json", appRoot), "utf8").then(
        JSON.parse,
      ),
      readFile(new URL("public/content/ch07-s01.json", appRoot), "utf8").then(
        JSON.parse,
      ),
      readFile(new URL("public/content/ch16-s01.json", appRoot), "utf8").then(
        JSON.parse,
      ),
      readFile(new URL("public/assets/katex.min.css", appRoot), "utf8"),
      readFile(
        new URL("public/assets/fonts/KaTeX_Main-Regular.woff2", appRoot),
      ),
    ]);

  assert.match(surplusRate.html, /class="katex-display"/);
  assert.match(surplusRate.html, /24c\+3v\+3m/);
  assert.doesNotMatch(surplusRate.html, /<p>\[\s*\\text/);
  assert.match(workingDay.html, /class="katex"/);
  assert.doesNotMatch(workingDay.html, /\\\(|\\\)/);
  assert.match(relativeSurplusValue.html, /class="mfrac"/);
  assert.doesNotMatch(relativeSurplusValue.html, /<h1>\[/);
  assert.match(mathCss, /url\(\/assets\/fonts\/KaTeX_Main-Regular\.woff2\)/);
  assert.ok(mainFont.length > 0);
});
