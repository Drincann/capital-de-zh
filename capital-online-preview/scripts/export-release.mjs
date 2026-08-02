import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import katex from "katex";
import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import { extractNarrationSentences } from "./narration-export.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(
  process.env.CAPITAL_PROJECT_ROOT ||
    path.join(appRoot, "..", "outputs", "capital-volume1-de-zh-new"),
);
const generatedRoot = path.join(appRoot, "generated");
const contentRoot = path.join(appRoot, "public", "content");
const publicAudioRoot = path.join(appRoot, "public", "audio");
const manifestPath = path.join(generatedRoot, "release-manifest.json");
const prefaceSourcePath = path.join(
  appRoot,
  "content",
  "translator-preface.md",
);

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(projectRoot))) {
  if (await exists(manifestPath)) {
    console.log("未找到翻译工程，沿用仓库中的正式发布快照。");
    process.exit(0);
  }
  throw new Error(`找不到翻译工程：${projectRoot}`);
}

function parseJsonLines(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function optionalJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function stripLeadingDocumentHeadings(value) {
  const lines = value.replace(/^\uFEFF/, "").split(/\r?\n/);
  while (lines[0]?.trim() === "") lines.shift();
  let removed = 0;
  while (removed < 2 && /^#{1,2}\s+\S/.test(lines[0] || "")) {
    lines.shift();
    while (lines[0]?.trim() === "") lines.shift();
    removed += 1;
  }
  return lines.join("\n").trim();
}

function safeFileName(value) {
  if (!/^[a-z0-9-]+$/i.test(value)) {
    throw new Error(`非法发布单元 ID：${value}`);
  }
  return `${value}.json`;
}

function renderMath(value, displayMode) {
  return katex.renderToString(value, {
    displayMode,
    output: "htmlAndMathml",
    strict: "ignore",
    throwOnError: false,
  });
}

function mathPlugin(markdown) {
  markdown.inline.ruler.before(
    "escape",
    "math_inline",
    (state, silent) => {
      if (state.src.slice(state.pos, state.pos + 2) !== "\\(") return false;

      const closingPosition = state.src.indexOf("\\)", state.pos + 2);
      if (closingPosition === -1) return false;

      if (!silent) {
        const token = state.push("math_inline", "math", 0);
        token.content = state.src.slice(state.pos + 2, closingPosition);
      }
      state.pos = closingPosition + 2;
      return true;
    },
  );

  markdown.block.ruler.before(
    "lheading",
    "math_block",
    (state, startLine, endLine, silent) => {
      const start = state.bMarks[startLine] + state.tShift[startLine];
      const firstLine = state.src.slice(start, state.eMarks[startLine]).trim();
      if (firstLine !== "\\[") return false;

      const lines = [];
      let nextLine = startLine + 1;
      while (nextLine < endLine) {
        const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
        const line = state.src.slice(lineStart, state.eMarks[nextLine]);
        if (line.trim() === "\\]") {
          if (silent) return true;

          const token = state.push("math_block", "math", 0);
          token.block = true;
          token.content = lines.join("\n");
          token.map = [startLine, nextLine + 1];
          state.line = nextLine + 1;
          return true;
        }
        lines.push(line);
        nextLine += 1;
      }
      return false;
    },
    { alt: ["paragraph", "reference", "blockquote", "list"] },
  );

  markdown.renderer.rules.math_inline = (tokens, index) =>
    renderMath(tokens[index].content, false);
  markdown.renderer.rules.math_block = (tokens, index) =>
    `${renderMath(tokens[index].content, true)}\n`;
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
})
  .use(mathPlugin)
  .use(footnote);

const [outline, adoptions, unitsText, versionsText] = await Promise.all([
  readFile(path.join(projectRoot, "manifests", "outline.json"), "utf8").then(
    JSON.parse,
  ),
  readFile(path.join(projectRoot, "manifests", "adoptions.json"), "utf8").then(
    JSON.parse,
  ),
  readFile(path.join(projectRoot, "manifests", "work-units.jsonl"), "utf8"),
  readFile(path.join(projectRoot, "manifests", "unit-versions.jsonl"), "utf8"),
]);

const units = parseJsonLines(unitsText);
const versions = parseJsonLines(versionsText);
const versionById = new Map(
  versions.map((version) => [version.version_id, version]),
);
const unitsByChapter = new Map();
const audioIndex =
  (await optionalJson(path.join(projectRoot, "audio", "index.json"))) || {
    audio_versions: [],
  };

for (const unit of units) {
  const list = unitsByChapter.get(unit.chapter_id) || [];
  list.push(unit);
  unitsByChapter.set(unit.chapter_id, list);
}
for (const list of unitsByChapter.values()) {
  list.sort((a, b) => Number(a.number || 0) - Number(b.number || 0));
}

await rm(contentRoot, { recursive: true, force: true });
await rm(publicAudioRoot, { recursive: true, force: true });
await mkdir(contentRoot, { recursive: true });
await mkdir(publicAudioRoot, { recursive: true });
await mkdir(generatedRoot, { recursive: true });

const prefaceMarkdown = stripLeadingDocumentHeadings(
  await readFile(prefaceSourcePath, "utf8"),
);
const prefaceHtml = md
  .render(prefaceMarkdown)
  .replace(
    /<p>ChatGPT<\/p>\s*$/,
    '<footer class="translator-signature"><strong>ChatGPT</strong><time datetime="2026-07">2026年7月</time></footer>',
  );
const prefaceSentences = extractNarrationSentences(
  prefaceMarkdown,
  md,
  "translator-preface",
);
const prefaceSha256 = sha256(await readFile(prefaceSourcePath));
const preface = {
  id: "translator-preface",
  number: 0,
  title: "译者序",
  versionId: "translator-preface-v1",
  contentPath: "/content/translator-preface.json",
};
await writeFile(
  path.join(contentRoot, "translator-preface.json"),
  `${JSON.stringify(
    {
      unitId: preface.id,
      chapterId: "front-matter",
      versionId: preface.versionId,
      translationSha256: prefaceSha256,
      title: preface.title,
      html: prefaceHtml,
      sentences: prefaceSentences,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const parts = [];
let publishedSectionCount = 0;
let publishedChapterCount = 0;

for (const part of outline.parts || []) {
  const chapters = [];
  for (const chapter of part.chapters || []) {
    const chapterUnits = unitsByChapter.get(chapter.chapter_id) || [];
    const sections = [];
    for (const unit of chapterUnits) {
      const versionId = adoptions[unit.unit_id];
      const version = versionById.get(versionId);
      if (!version?.artifact_path) continue;

      const artifactPath = path.join(projectRoot, version.artifact_path);
      if (!(await exists(artifactPath))) continue;

      const markdown = stripLeadingDocumentHeadings(
        await readFile(artifactPath, "utf8"),
      );
      const translationSha256 = sha256(await readFile(artifactPath));
      const html = md.render(markdown);
      const sentences = extractNarrationSentences(markdown, md, unit.unit_id);
      const contentFile = safeFileName(unit.unit_id);
      const audioRecord = (audioIndex.audio_versions || [])
        .filter(
          (record) =>
            record.status === "ready" &&
            record.unit_id === unit.unit_id &&
            record.translation_version_id === versionId &&
            record.translation_sha256 === translationSha256,
        )
        .sort((left, right) =>
          String(right.created_at || "").localeCompare(
            String(left.created_at || ""),
          ),
        )[0];
      let audioManifestPath;

      if (audioRecord?.manifest_path) {
        const sourceManifestPath = path.join(
          projectRoot,
          audioRecord.manifest_path,
        );
        const audioManifest = await optionalJson(sourceManifestPath);
        if (
          audioManifest?.status === "ready" &&
          audioManifest.translation_version_id === versionId &&
          audioManifest.translation_sha256 === translationSha256
        ) {
          const destination = path.join(
            publicAudioRoot,
            audioRecord.audio_version_id,
          );
          await mkdir(destination, { recursive: true });
          for (const chunk of audioManifest.chunks || []) {
            await copyFile(
              path.join(path.dirname(sourceManifestPath), chunk.audio_file),
              path.join(destination, path.basename(chunk.audio_file)),
            );
          }
          await copyFile(
            sourceManifestPath,
            path.join(destination, "manifest.json"),
          );
          audioManifestPath = `/audio/${audioRecord.audio_version_id}/manifest.json`;
        }
      }

      await writeFile(
        path.join(contentRoot, contentFile),
        `${JSON.stringify(
          {
            unitId: unit.unit_id,
            chapterId: chapter.chapter_id,
            versionId,
            translationSha256,
            title: unit.title_zh,
            html,
            sentences,
            audioManifestPath,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      sections.push({
        id: unit.unit_id,
        number: Number(unit.number || sections.length + 1),
        title: unit.title_zh,
        versionId,
        contentPath: `/content/${contentFile}`,
        audioManifestPath,
      });
      publishedSectionCount += 1;
    }

    chapters.push({
      id: chapter.chapter_id,
      number: Number(chapter.number || chapters.length + 1),
      title: chapter.title_zh,
      available: sections.length > 0,
      sections,
    });
    if (sections.length) {
      publishedChapterCount += 1;
    }
  }

  if (chapters.length) {
    parts.push({
      id: part.part_id,
      number: Number(part.number || parts.length + 1),
      title: part.title_zh,
      chapters,
    });
  }
}

const manifest = {
  title: outline.title_zh || "《资本论》第一卷",
  editionTitle: "ChatGPT 译",
  generatedAt: new Date().toISOString(),
  partCount: parts.length,
  chapterCount: parts.reduce((total, part) => total + part.chapters.length, 0),
  publishedChapterCount,
  sectionCount: publishedSectionCount,
  preface,
  parts,
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const contentFiles = (await readdir(contentRoot)).filter((name) =>
  name.endsWith(".json"),
);
if (contentFiles.length !== publishedSectionCount + 1) {
  throw new Error("发布正文数量与目录不一致。");
}

console.log(
  `已生成公开阅读快照：${publishedChapterCount} 章，${publishedSectionCount} 节。`,
);
