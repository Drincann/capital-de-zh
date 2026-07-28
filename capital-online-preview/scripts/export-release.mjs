import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(
  process.env.CAPITAL_PROJECT_ROOT ||
    path.join(appRoot, "..", "outputs", "capital-volume1-de-zh-new"),
);
const generatedRoot = path.join(appRoot, "generated");
const contentRoot = path.join(appRoot, "public", "content");
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

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
}).use(footnote);

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

for (const unit of units) {
  const list = unitsByChapter.get(unit.chapter_id) || [];
  list.push(unit);
  unitsByChapter.set(unit.chapter_id, list);
}
for (const list of unitsByChapter.values()) {
  list.sort((a, b) => Number(a.number || 0) - Number(b.number || 0));
}

await rm(contentRoot, { recursive: true, force: true });
await mkdir(contentRoot, { recursive: true });
await mkdir(generatedRoot, { recursive: true });

const prefaceMarkdown = stripLeadingDocumentHeadings(
  await readFile(prefaceSourcePath, "utf8"),
);
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
      title: preface.title,
      html: md.render(prefaceMarkdown),
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
      const html = md.render(markdown);
      const contentFile = safeFileName(unit.unit_id);

      await writeFile(
        path.join(contentRoot, contentFile),
        `${JSON.stringify(
          {
            unitId: unit.unit_id,
            chapterId: chapter.chapter_id,
            versionId,
            title: unit.title_zh,
            html,
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
  editionTitle: "ChatGPT 5.6 Sol 译",
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
