import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { setAdoptedVersion } from "../scripts/adoption-state.mjs";
import { setAdoptedAudioVersion } from "../scripts/audio-adoption-state.mjs";
import {
  audioStateFor,
  collapseIdenticalVersions,
  createProgressState,
} from "../scripts/progress-state.mjs";

const projectRoot = fileURLToPath(
  new URL("../../outputs/capital-volume1-de-zh-new/", import.meta.url)
);

test("interface stays focused on catalog, versions and reading", async () => {
  const html = await readFile(
    new URL("../public/index.html", import.meta.url),
    "utf8"
  );
  assert.match(html, /翻译目录/);
  assert.match(html, /全书目录/);
  assert.match(html, />正文</);
  assert.match(html, />版本</);
  assert.match(html, /\/api\/state/);
  assert.match(html, /\/api\/adopt/);
  assert.match(html, /\/api\/audio\/generate/);
  assert.match(html, /\/api\/audio\/plan/);
  assert.match(html, /\/api\/audio\/adopt/);
  assert.match(html, /\/api\/audio\/manifest/);
  assert.match(html, /生成语音/);
  assert.match(html, /\["generating", "failed", "interrupted"\]/);
  assert.match(html, /item\.completedChunks/);
  assert.match(html, /生成前确认/);
  assert.match(html, /generatedChunkCount/);
  assert.match(html, /Math\.round/);
  assert.match(html, /100\)}%/);
  assert.match(html, /audio-status/);
  assert.match(html, /id="narrationAudio"/);
  assert.match(html, /id="narrationPlayer"/);
  assert.match(html, /id="narrationProgress"/);
  assert.match(html, /id="narrationRate"/);
  assert.match(html, /data-narration-sentence/);
  assert.match(html, /narrationStartButton/);
  assert.match(html, /采用此版本/);
  assert.match(html, /stripLeadingDocumentHeadings/);
  assert.match(html, /data-theme="dark"/);
  assert.match(html, /capital-progress-theme/);
  assert.match(html, /id="themeToggle"/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /id="catalogCollapse"/);
  assert.match(html, /id="catalogExpand"/);
  assert.match(html, /class="catalog-toolbar"/);
  assert.match(html, /catalog-collapsed/);
  assert.match(html, /capital-progress-catalog-collapsed/);
  assert.match(html, /capital-progress-reading-position/);
  assert.match(html, /saveReadingPosition/);
  assert.match(html, /class="chapter-sections"/);
  assert.match(html, /class="catalog-section/);
  assert.match(html, /function selectUnit/);
  assert.match(html, /function chapterCatalogFacts/);
  assert.match(html, /function unitVersionCatalogFact/);
  assert.match(html, /function unitAudioCatalogFact/);
  assert.match(html, /function unitPublicationCatalogFact/);
  assert.match(html, /第\$\{unit\.currentVersion\}版已采用/);
  assert.match(html, /旧语音不可用/);
  assert.match(html, /已上传，待上线/);
  assert.match(html, /语音生成中断/);
  assert.match(html, /上传失败/);
  assert.doesNotMatch(html, /id="sectionList"/);
  assert.doesNotMatch(html, /\.section-list\s*\{/);
  assert.match(html, /max-width: 900px/);
  assert.match(html, /scrollIntoView/);
  assert.match(html, /比较版本/);
  assert.match(html, /renderVersionDiff/);
  assert.match(html, /只看改动/);
  assert.match(html, /data-diff-mode="inline"/);
  assert.match(html, /data-diff-mode="paragraph"/);
  assert.match(html, /paragraph-mode/);
  assert.match(html, /data-version-picker/);
  assert.match(html, /终审待复核/);
  assert.match(html, /version\.reviewStatus === "needs_review"/);
  assert.match(html, /\.prose \.footnotes li:target/);
  assert.doesNotMatch(html, /<select\b/);
  assert.match(
    html,
    /renderMarkdown\(stripLeadingDocumentHeadings\(preview\)\)/
  );
  assert.doesNotMatch(html, /原文、初译、校对与组章共用同一份状态/);
  assert.doesNotMatch(html, /读者理解优先；允许改写句法/);
  assert.doesNotMatch(html, /数据直接来自正式翻译项目，不上传云端/);
  assert.doesNotMatch(html, /等待你的审核/);
});

test("stalled audio generation becomes resumable", () => {
  const version = { id: "ch05-s01-v6", translationSha256: "translation-sha" };
  const updatedAt = "2026-08-02T16:00:00.000Z";
  const audio = audioStateFor(
    version,
    "ch05-s01",
    version.id,
    [
      {
        audio_version_id: "audio-version",
        unit_id: "ch05-s01",
        translation_version_id: version.id,
        translation_sha256: version.translationSha256,
        status: "generating",
        updated_at: updatedAt,
        completed_chunks: 11,
        chunk_count: 26,
      },
    ],
    Date.parse(updatedAt) + 8 * 60 * 1000,
  );
  assert.equal(audio.status, "interrupted");
  assert.equal(audio.canGenerate, true);
  assert.equal(audio.completedChunks, 11);
  assert.match(audio.error, /继续/);
});

test("an upload left running across a task-station restart becomes resumable", () => {
  const version = { id: "unit-v1", translationSha256: "translation-sha" };
  const audio = audioStateFor(
    version,
    "unit",
    version.id,
    [
      {
        audio_version_id: "audio-1",
        unit_id: "unit",
        translation_version_id: version.id,
        translation_sha256: version.translationSha256,
        model_id: "seed-audio-1.0",
        status: "ready",
        updated_at: "2026-08-03T01:00:00.000Z",
      },
    ],
    Date.parse("2026-08-03T03:00:00.000Z"),
    [{ id: "seed-audio-1.0", label: "现有模型 1.0" }],
    { "unit-v1": "audio-1" },
    {
      audio_versions: {
        "audio-1": {
          status: "uploading",
          completed_files: 12,
          file_count: 22,
        },
      },
      adoptions: {},
    },
  );
  const publication = audio.versions[0].publication;
  assert.equal(publication.status, "interrupted");
  assert.equal(publication.label, "上传已中断 12/22");
  assert.equal(publication.canPublish, true);
  assert.match(publication.error, /继续上传/);
});

test("audio models can coexist while only one ready version is adopted", () => {
  const version = { id: "unit-v1", translationSha256: "translation-sha" };
  const audio = audioStateFor(
    version,
    "unit",
    version.id,
    [
      {
        audio_version_id: "audio-1",
        unit_id: "unit",
        translation_version_id: version.id,
        translation_sha256: version.translationSha256,
        model_id: "seed-audio-1.0",
        status: "ready",
        updated_at: "2026-08-03T01:00:00.000Z",
      },
      {
        audio_version_id: "audio-2",
        unit_id: "unit",
        translation_version_id: version.id,
        translation_sha256: version.translationSha256,
        model_id: "seed-tts-2.0",
        status: "ready",
        updated_at: "2026-08-03T02:00:00.000Z",
      },
    ],
    Date.parse("2026-08-03T03:00:00.000Z"),
    [
      { id: "seed-audio-1.0", label: "现有模型 1.0" },
      { id: "seed-tts-2.0", label: "Seed-TTS 2.0" },
    ],
    { "unit-v1": "audio-1" },
  );
  assert.equal(audio.status, "ready");
  assert.equal(audio.audioVersionId, "audio-1");
  assert.equal(audio.versions.length, 2);
  assert.equal(audio.versions.find((item) => item.id === "audio-1").adopted, true);
  assert.equal(audio.versions.find((item) => item.id === "audio-2").adopted, false);
});

test("inline interface scripts parse successfully", async () => {
  const html = await readFile(
    new URL("../public/index.html", import.meta.url),
    "utf8"
  );
  const scripts = Array.from(
    html.matchAll(/<script>([\s\S]*?)<\/script>/g),
    (match) => match[1]
  );
  assert.ok(scripts.length >= 2);
  scripts.forEach((source) => {
    assert.doesNotThrow(() => new Function(source));
  });
});

test("version picker collapses identical text and retains the adopted record", () => {
  const versions = collapseIdenticalVersions([
    { id: "u-v3", number: 3, preview: "新版", adopted: false },
    { id: "u-v2", number: 2, preview: "同一正文\r\n", adopted: true },
    { id: "u-v1", number: 1, preview: "同一正文\n", adopted: false },
  ]);

  assert.deepEqual(
    versions.map((version) => version.id),
    ["u-v3", "u-v2"]
  );
});

test("reader renders the Markdown used by translation previews", async () => {
  const html = await readFile(
    new URL("../public/index.html", import.meta.url),
    "utf8"
  );
  const source = html.match(
    /function escapeHtml[\s\S]*?(?=\n\s*function stripLeadingDocumentHeadings)/
  )?.[0];
  assert.ok(source);
  const renderMarkdown = new Function(
    `${source}; return renderMarkdown;`
  )();
  const rendered = renderMarkdown([
    "### 小标题",
    "",
    "正文有 **重点**、`代码`、[链接](https://example.com) 和脚注[^38]，另有补充脚注[^205a]。",
    "",
    "- 第一项",
    "- 第二项",
    "",
    "> 一段引用",
    "",
    "| 名称 | 数值 |",
    "| --- | ---: |",
    "| 棉花 | 20 |",
    "",
    "[^38]: 这是脚注。",
    "",
    "[^205a]: 这是补充脚注。",
    "",
    "[^232]: 表格也属于脚注。",
    "",
    "    | 品类 | 1846年 | 1860年 |",
    "    | --- | ---: | ---: |",
    "    | 棉花 | 34 | 204 |",
    "",
    "<script>alert(1)</script>",
    "[危险链接](javascript:alert(1))",
    "",
    "Inline math \\(ab+bc\\), fraction \\(16\\frac{2}{3}\\%\\), and product \\(365\\times30\\).",
    "",
    "\\[",
    "\\text{value }30=24c+3v+3m",
    "\\]",
    "",
    "Code keeps math delimiters: `\\(raw\\)`.",
  ].join("\n"));

  assert.match(rendered, /<h3>小标题<\/h3>/);
  assert.match(rendered, /<strong>重点<\/strong>/);
  assert.match(rendered, /<code>代码<\/code>/);
  assert.match(rendered, /<ul><li>第一项<\/li><li>第二项<\/li><\/ul>/);
  assert.match(rendered, /<blockquote><p>一段引用<\/p><\/blockquote>/);
  assert.match(rendered, /<table>/);
  assert.match(rendered, /id="fnref-38-1"/);
  assert.match(rendered, /id="fn-38"/);
  assert.match(rendered, /class="footnote-number">38\.<\/span>/);
  assert.match(rendered, /class="footnote-number">205a\.<\/span>/);
  assert.match(rendered, /class="footnote-text">这是脚注。/);
  assert.match(
    rendered,
    /<li id="fn-232">[\s\S]*?<div class="footnote-text is-block">[\s\S]*?<table>/
  );
  assert.match(rendered, /<td>棉花<\/td><td>34<\/td><td>204<\/td>/);
  assert.match(rendered, /class="footnote-backref"/);
  assert.match(rendered, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(rendered, /href="javascript:/);
  assert.match(rendered, /class="math-inline"/);
  assert.match(rendered, /class="math-frac"/);
  assert.match(rendered, /365×30/);
  assert.match(rendered, /class="math-display"/);
  assert.match(rendered, /class="math-text">value /);
  assert.match(rendered, /<code>\\\(raw\\\)<\/code>/);
  assert.doesNotMatch(rendered, /\\\(ab\+bc\\\)/);
  assert.doesNotMatch(rendered, /\\\[|\\\]/);
});

test("long footnote continuations stay visible inside their source footnotes", async () => {
  const html = await readFile(
    new URL("../public/index.html", import.meta.url),
    "utf8"
  );
  const source = html.match(
    /function escapeHtml[\s\S]*?(?=\n\s*function stripLeadingDocumentHeadings)/
  )?.[0];
  assert.ok(source);
  const renderMarkdown = new Function(
    `${source}; return renderMarkdown;`
  )();
  const markdown = await readFile(
    path.join(projectRoot, "chapters", "ch08s04", "assembled.md"),
    "utf8"
  );
  const rendered = renderMarkdown(markdown);
  const footnoteStart = rendered.indexOf('<section class="footnotes"');
  assert.ok(footnoteStart > 0);
  const main = rendered.slice(0, footnoteStart);
  const footnotes = rendered.slice(footnoteStart);

  assert.doesNotMatch(main, /上述金属工场实行的制度/);
  assert.doesNotMatch(main, /在制造玻璃瓶和燧石玻璃的工场里/);
  assert.match(
    footnotes,
    /<li id="fn-98">[\s\S]*?上述金属工场实行的制度/
  );
  assert.match(
    footnotes,
    /<li id="fn-103">[\s\S]*?在制造玻璃瓶和燧石玻璃的工场里/
  );
});

test("outline contains seven parts and twenty-five chapters", async () => {
  const state = await createProgressState(projectRoot);
  const chapters = state.parts.flatMap((part) => part.chapters);
  assert.equal(state.book.partCount, 7);
  assert.equal(state.book.chapterCount, 25);
  assert.equal(state.book.frontMatterCount, 4);
  assert.deepEqual(
    state.frontMatter.map((item) => item.title),
    ["第一版序言", "第二版跋", "第三版序言", "第四版序言"]
  );
  assert.ok(
    state.frontMatter.every((item) => item.sections.length === 1)
  );
  assert.equal(state.defaultChapterId, "ch01");
  assert.equal(chapters.length, 25);
  assert.equal(new Set(chapters.map((chapter) => chapter.id)).size, 25);
});

test("chapter and section state reflects current review tasks and saved versions", async () => {
  const state = await createProgressState(projectRoot);
  const chapters = state.parts.flatMap((part) => part.chapters);
  const chapterFive = chapters.find((chapter) => chapter.id === "ch05");
  const chapterOne = chapters.find((chapter) => chapter.id === "ch01");
  const commodityFactors = chapterOne.sections.find(
    (section) => section.unit_id === "ch01-s01"
  );
  const labourProcess = chapterFive.sections.find(
    (section) => section.unit_id === "ch05-s01"
  );
  const valorization = chapterFive.sections.find(
    (section) => section.unit_id === "ch05-s02"
  );
  const chapterEight = chapters.find((chapter) => chapter.id === "ch08");
  const terminalReviewSection = chapterEight.sections.find(
    (section) => section.unit_id === "ch08-s03"
  );

  assert.ok(["in_progress", "completed"].includes(chapterFive.status));
  assert.equal(
    chapterFive.completedSections,
    chapterFive.sections.filter((section) => section.status === "completed").length
  );
  assert.equal(chapterFive.totalSections, 2);
  assert.equal(
    chapterFive.versionCount,
    Math.max(labourProcess.versionCount, valorization.versionCount)
  );
  assert.equal(labourProcess.status, "completed");
  assert.ok(labourProcess.versionCount >= 6);
  assert.ok(
    !labourProcess.adoptedVersionId
      || labourProcess.versions.some(
        (version) => version.id === labourProcess.adoptedVersionId
      )
  );
  assert.match(labourProcess.preview, /## 一、劳动过程/);
  assert.match(labourProcess.preview, /劳动力的实际使用，就是劳动/);
  assert.ok(
    ["source_ready", "in_progress", "completed"].includes(valorization.status)
  );
  assert.ok(valorization.versionCount >= 1);
  assert.match(valorization.preview, /## 二、价值增殖过程/);
  assert.equal(chapterOne.status, "completed");
  assert.equal(chapterOne.completedSections, chapterOne.totalSections);
  assert.equal(commodityFactors.status, "completed");
  assert.ok(commodityFactors.versionCount >= 6);
  assert.ok(
    commodityFactors.tasks.every(
      (task) => task.status === "approved" && task.preview !== ""
    )
  );
  assert.ok(terminalReviewSection.versionCount >= 1);
  assert.equal(
    terminalReviewSection.versions.length,
    terminalReviewSection.versionCount
  );
  assert.ok(
    ["in_progress", "needs_review", "completed"].includes(
      terminalReviewSection.status
    )
  );
  if (terminalReviewSection.status === "needs_review") {
    assert.equal(terminalReviewSection.adoptedVersionId, "");
    assert.equal(
      terminalReviewSection.versions.at(-1).reviewStatus,
      "needs_review"
    );
    assert.match(terminalReviewSection.versions.at(-1).reviewNote, /13岁/);
  }
  assert.notEqual(terminalReviewSection.preview, "");
  const voiced = chapters
    .flatMap((chapter) => chapter.sections)
    .find((section) => section.unit_id === "ch07-s04");
  assert.equal(voiced.adoptedVersionId, "ch07-s04-v1");
  assert.equal(voiced.audio.status, "ready");
  assert.equal(voiced.audio.exact, true);
  assert.equal(voiced.audio.canGenerate, true);
  assert.equal(voiced.audio.models.find((model) => model.id === "seed-tts-2.0").canGenerate, true);
  assert.equal(voiced.audio.chunkCount, 2);
});

test("adoption marker validates the unit and persists locally", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capital-adoption-"));
  try {
    await mkdir(path.join(root, "manifests"), { recursive: true });
    await writeFile(
      path.join(root, "manifests", "unit-versions.jsonl"),
      [
        JSON.stringify({
          version_id: "unit-a-v1",
          unit_id: "unit-a",
          number: 1,
          artifact_path: "reader-edition/a.md",
        }),
        JSON.stringify({
          version_id: "unit-b-v1",
          unit_id: "unit-b",
          number: 1,
          artifact_path: "reader-edition/b.md",
        }),
        JSON.stringify({
          version_id: "unit-a-v2",
          unit_id: "unit-a",
          number: 2,
          artifact_path: "reader-edition/a-v2.md",
          review_status: "needs_review",
          review_note: "存在待复核表述",
        }),
      ].join("\n") + "\n",
      "utf8"
    );
    await writeFile(
      path.join(root, "manifests", "adoptions.json"),
      "{}\n",
      "utf8"
    );

    await setAdoptedVersion(root, "unit-a", "unit-a-v1");
    const stored = JSON.parse(
      await readFile(path.join(root, "manifests", "adoptions.json"), "utf8")
    );
    assert.equal(stored["unit-a"], "unit-a-v1");
    await assert.rejects(
      setAdoptedVersion(root, "unit-a", "unit-b-v1"),
      /版本与翻译单元不匹配/
    );
    await assert.rejects(
      setAdoptedVersion(root, "unit-a", "unit-a-v2"),
      /仍有终审问题/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("audio adoption is independent and validates the adopted translation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capital-audio-adoption-"));
  try {
    await mkdir(path.join(root, "manifests"), { recursive: true });
    await mkdir(path.join(root, "audio"), { recursive: true });
    await writeFile(
      path.join(root, "manifests", "adoptions.json"),
      '{"unit-a":"unit-a-v1"}\n',
      "utf8",
    );
    await writeFile(
      path.join(root, "audio", "index.json"),
      `${JSON.stringify({
        audio_versions: [
          {
            audio_version_id: "audio-2",
            unit_id: "unit-a",
            translation_version_id: "unit-a-v1",
            status: "ready",
          },
          {
            audio_version_id: "audio-pending",
            unit_id: "unit-a",
            translation_version_id: "unit-a-v1",
            status: "generating",
          },
        ],
      })}\n`,
      "utf8",
    );

    await setAdoptedAudioVersion(
      root,
      "unit-a",
      "unit-a-v1",
      "audio-2",
    );
    const stored = JSON.parse(
      await readFile(path.join(root, "audio", "adoptions.json"), "utf8"),
    );
    assert.equal(stored["unit-a-v1"], "audio-2");
    await assert.rejects(
      setAdoptedAudioVersion(
        root,
        "unit-a",
        "unit-a-v1",
        "audio-pending",
      ),
      /尚未完成/,
    );
    await assert.rejects(
      setAdoptedAudioVersion(root, "unit-a", "unit-a-v2", "audio-2"),
      /当前采用的译文/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
