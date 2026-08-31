import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const defaultOutputDir = path.join(projectDir, "output", "pdf");
const defaultTempDir = path.join(projectDir, "tmp", "pdfs");
const defaultPdfPath = path.join(defaultOutputDir, "capital-volume1-modern-chinese.pdf");
const defaultHtmlPath = path.join(defaultTempDir, "capital-volume1-modern-chinese.html");

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (!value.startsWith("--")) continue;
  const next = process.argv[index + 1];
  if (next && !next.startsWith("--")) {
    args.set(value, next);
    index += 1;
  } else {
    args.set(value, true);
  }
}

const pdfPath = path.resolve(args.get("--output") || defaultPdfPath);
const htmlPath = path.resolve(args.get("--html-output") || defaultHtmlPath);
const chromePath = args.get("--chrome") || findChrome();

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function namespaceHtml(html, namespace) {
  return html
    .replace(/\bid="([^"]+)"/g, (_, id) => `id="${namespace}-${id}"`)
    .replace(/\bhref="#([^"]+)"/g, (_, id) => `href="#${namespace}-${id}"`);
}

function stripLeadingDuplicateTitle(html, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html
    .replace(new RegExp(`^\\s*${escaped}\\s*(?=<)`), "")
    .replace(new RegExp(`^\\s*<p>\\s*${escaped}\\s*</p>\\s*`, "i"), "");
}

function sameTitle(left, right) {
  return String(left || "").replace(/[\s：:，,。·]/g, "") === String(right || "").replace(/[\s：:，,。·]/g, "");
}

async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function loadKatexCss() {
  const cssPath = path.join(projectDir, "public", "assets", "katex.min.css");
  const assetsUrl = pathToFileURL(path.join(projectDir, "public", "assets")).href;
  return (await readFile(cssPath, "utf8"))
    .replaceAll("url(/assets/", `url(${assetsUrl}/`);
}

function resolveContentPath(contentPath) {
  return path.join(projectDir, "public", contentPath.replace(/^\//, ""));
}

function frontMatterLabel(item) {
  return item.id === "translator-preface" ? "" : "《资本论》第一卷";
}

async function renderUnit(unit, { kind, chapter, sectionNumber } = {}) {
  const source = await loadJson(resolveContentPath(unit.contentPath));
  const namespace = `book-${unit.id}`;
  const cleanHtml = stripLeadingDuplicateTitle(source.html || "", unit.title);
  const body = namespaceHtml(cleanHtml, namespace);

  if (kind === "front") {
    return `<article class="front-matter" id="${namespace}">
      <header class="front-matter-header">
        <p class="eyebrow">${escapeHtml(frontMatterLabel(unit))}</p>
        <h1>${escapeHtml(unit.title)}</h1>
      </header>
      <div class="prose">${body}</div>
    </article>`;
  }

  const omitSectionTitle = chapter.sections.length === 1 && sameTitle(chapter.title, unit.title);
  return `<section class="book-section" id="${namespace}">
    ${omitSectionTitle ? "" : `<header class="section-header"><p class="section-number">${sectionNumber}</p><h2>${escapeHtml(unit.title)}</h2></header>`}
    <div class="prose">${body}</div>
  </section>`;
}

function renderToc(manifest) {
  const frontItems = [manifest.preface, ...manifest.frontMatter]
    .map((item) => `<li class="toc-front"><a href="#book-${item.id}">${escapeHtml(item.title)}</a></li>`)
    .join("");

  const parts = manifest.parts.map((part) => {
    const chapters = part.chapters.map((chapter) => {
      const sections = chapter.sections.length > 1
        ? `<ol class="toc-sections">${chapter.sections.map((section) => `<li><a href="#book-${section.id}">${section.number}. ${escapeHtml(section.title)}</a></li>`).join("")}</ol>`
        : "";
      return `<li class="toc-chapter">
        <a href="#book-${chapter.id}"><span>第${chapter.number}章</span>${escapeHtml(chapter.title)}</a>
        ${sections}
      </li>`;
    }).join("");
    return `<section class="toc-part">
      <h2><span>第${part.number}篇</span>${escapeHtml(part.title)}</h2>
      <ol>${chapters}</ol>
    </section>`;
  }).join("");

  return `<article class="contents" id="contents">
    <header><p class="eyebrow">《资本论》第一卷</p><h1>目录</h1></header>
    <ol class="toc-front-list">${frontItems}</ol>
    ${parts}
  </article>`;
}

function renderCover() {
  return `<article class="cover">
    <div class="cover-rule"></div>
    <div class="cover-copy">
      <h1>资本论</h1>
      <p class="cover-volume">第一卷</p>
      <p class="cover-author">卡尔·马克思</p>
    </div>
    <div class="cover-meta">
      <p>ChatGPT 译</p>
      <p>2026年9月</p>
    </div>
  </article>`;
}

function renderPartDivider(part) {
  return `<article class="part-divider" id="book-${part.id}">
    <div>
      <p>第${part.number}篇</p>
      <h1>${escapeHtml(part.title)}</h1>
    </div>
  </article>`;
}

async function renderBook(manifest) {
  const frontMatter = [];
  for (const item of [manifest.preface, ...manifest.frontMatter]) {
    frontMatter.push(await renderUnit(item, { kind: "front" }));
  }

  const parts = [];
  for (const part of manifest.parts) {
    parts.push(renderPartDivider(part));
    for (const chapter of part.chapters) {
      const sections = [];
      for (const section of chapter.sections) {
        sections.push(await renderUnit(section, {
          kind: "section",
          chapter,
          sectionNumber: chapter.sections.length > 1 ? `第${section.number}节` : "",
        }));
      }
      parts.push(`<article class="chapter" id="book-${chapter.id}">
        <header class="chapter-header">
          <p>第${chapter.number}章</p>
          <h1>${escapeHtml(chapter.title)}</h1>
        </header>
        ${sections.join("\n")}
      </article>`);
    }
  }

  return [renderCover(), renderToc(manifest), ...frontMatter, ...parts].join("\n");
}

const css = String.raw`
  :root {
    color-scheme: light;
    --ink: #231f1b;
    --muted: #756d65;
    --line: #d7d0c7;
    --accent: #9a4f3b;
    --paper: #ffffff;
  }

  @page {
    size: A4;
    margin: 20mm 18mm 22mm;
    background: #ffffff;
    @bottom-center {
      content: counter(page);
      color: #81786f;
      font-family: "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
      font-size: 8pt;
    }
  }

  @page cover {
    margin: 0;
    border-left: 9mm solid #9a4f3b;
    background: #f7f2e9;
    @bottom-center { content: ""; }
  }

  @page divider {
    margin: 0;
    background: #28231f;
    @bottom-center { content: ""; }
  }

  * { box-sizing: border-box; }

  html {
    font-family: "Noto Serif SC", "Noto Serif CJK SC", "Songti SC", SimSun, serif;
    font-size: 10.5pt;
    font-weight: 440;
    color: var(--ink);
    background: transparent;
    text-rendering: optimizeLegibility;
  }

  body { margin: 0; background: transparent; }

  a { color: inherit; text-decoration: none; }

  .cover {
    page: cover;
    position: relative;
    height: 297mm;
    padding: 31mm 27mm 25mm 18mm;
    break-after: page;
    background: radial-gradient(circle at 80% 16%, rgba(154, 79, 59, 0.09), transparent 38%);
  }

  .cover-rule { width: 22mm; border-top: 1.4mm solid var(--ink); margin-top: 15mm; }

  .cover-copy { margin-top: 55mm; }

  .eyebrow,
  .chapter-header p,
  .section-number,
  .part-divider p {
    font-family: "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
    letter-spacing: 0.12em;
  }

  .cover h1 { margin: 0; font-size: 47pt; font-weight: 720; letter-spacing: 0.08em; line-height: 1.08; }
  .cover-volume { margin: 7mm 0 0; font-size: 21pt; letter-spacing: 0.32em; }
  .cover-author { margin: 27mm 0 0; font-size: 13pt; letter-spacing: 0.15em; }
  .cover-meta { position: absolute; right: 27mm; bottom: 25mm; text-align: right; color: var(--muted); font-family: "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif; font-size: 9pt; line-height: 1.8; }
  .cover-meta p { margin: 0; }

  .contents { break-after: page; }
  .contents > header { margin-bottom: 10mm; padding-bottom: 5mm; border-bottom: 0.35mm solid var(--ink); }
  .contents h1, .front-matter h1 { margin: 1.8mm 0 0; font-size: 28pt; line-height: 1.25; }
  .eyebrow { margin: 0; color: var(--accent); font-size: 8.5pt; }
  .toc-front-list, .toc-part ol { list-style: none; margin: 0; padding: 0; }
  .toc-front-list { margin-bottom: 8mm; padding-bottom: 5mm; border-bottom: 0.25mm solid var(--line); }
  .toc-front { margin: 0 0 2.2mm; font-size: 10pt; }
  .toc-part { margin: 0 0 8mm; break-inside: avoid; }
  .toc-part h2 { display: flex; gap: 4mm; margin: 0 0 3mm; font-size: 13pt; line-height: 1.4; }
  .toc-part h2 span { min-width: 12mm; color: var(--accent); font-family: "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif; font-size: 8.5pt; padding-top: 1.6mm; }
  .toc-chapter { margin: 0 0 2.2mm; }
  .toc-chapter > a { display: grid; grid-template-columns: 17mm 1fr; gap: 2mm; align-items: baseline; font-size: 10pt; }
  .toc-chapter > a span { color: var(--muted); font-family: "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif; font-size: 8.5pt; }
  .toc-sections { margin: 1.5mm 0 3mm 19mm !important; }
  .toc-sections li { margin: 1mm 0; color: #4d4741; font-size: 8.8pt; line-height: 1.45; }

  .front-matter, .chapter { break-before: page; }
  .front-matter-header, .chapter-header { margin: 0 0 12mm; padding-bottom: 6mm; border-bottom: 0.4mm solid var(--ink); }
  .chapter-header p { margin: 0 0 2mm; color: var(--accent); font-size: 9pt; }
  .chapter-header h1 { margin: 0; font-size: 27pt; line-height: 1.3; }

  .part-divider {
    page: divider;
    display: flex;
    align-items: center;
    height: 297mm;
    padding: 0 28mm;
    break-before: page;
    break-after: page;
    background: transparent;
    color: #f7f2e9;
  }
  .part-divider p { margin: 0 0 8mm; color: #d99984; font-size: 11pt; }
  .part-divider h1 { max-width: 145mm; margin: 0; font-size: 35pt; line-height: 1.25; letter-spacing: 0.04em; }

  .book-section + .book-section { margin-top: 15mm; padding-top: 10mm; border-top: 0.25mm solid var(--line); }
  .section-header { margin: 0 0 9mm; break-after: avoid; }
  .section-number { margin: 0 0 1.5mm; color: var(--accent); font-size: 8.5pt; }
  .section-header h2 { margin: 0; font-size: 19pt; line-height: 1.35; }

  .prose { line-height: 1.88; text-align: justify; text-justify: inter-ideograph; }
  .prose p { margin: 0 0 4.2mm; orphans: 2; widows: 2; }
  .prose h2, .prose h3, .prose h4, .prose h5, .prose h6 { break-after: avoid; page-break-after: avoid; line-height: 1.45; text-align: left; }
  .prose h2 { margin: 12mm 0 5mm; font-size: 18pt; }
  .prose h3 { margin: 10mm 0 4mm; font-size: 15pt; }
  .prose h4 { margin: 8mm 0 3.5mm; font-size: 12.5pt; }
  .prose h5 { margin: 6mm 0 3mm; font-size: 11.5pt; }
  .prose h6 { margin: 5mm 0 2.5mm; font-size: 10.5pt; }
  .prose h2 + h3, .prose h3 + h4, .prose h4 + h5 { margin-top: 3mm; }
  .prose blockquote { margin: 5mm 4mm 5mm 7mm; padding: 1mm 0 1mm 5mm; border-left: 0.8mm solid var(--accent); color: #4d4741; }
  .prose blockquote p { margin: 0 0 2mm; }
  .prose blockquote p:last-child { margin-bottom: 0; }
  .prose em { text-emphasis: none; }
  .prose strong { font-weight: 720; }
  .prose code { font-family: "Noto Sans Mono CJK SC", Consolas, monospace; font-size: 0.88em; }
  .prose sup { line-height: 0; }

  /* The PDF keeps KaTeX's visual layer only. Printing both the MathML and
     HTML layers duplicates every symbol in the page and copied text. */
  .katex .katex-mathml { display: none !important; }

  .prose table { width: 100%; margin: 5mm 0 7mm; border-collapse: collapse; font-family: "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif; font-size: 8.2pt; line-height: 1.5; break-inside: auto; }
  .prose thead { display: table-header-group; }
  .prose tr { break-inside: avoid; page-break-inside: avoid; }
  .prose th, .prose td { padding: 2.1mm 2.3mm; border: 0.25mm solid #bfb7ae; vertical-align: top; }
  .prose th { background: #eee8df; font-weight: 650; text-align: left; }

  .footnote-ref a { color: var(--accent); font-family: "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif; font-size: 0.76em; }
  .footnotes-sep { width: 24mm; margin: 10mm 0 5mm; border: 0; border-top: 0.35mm solid var(--ink); }
  .footnotes {
    color: #403a35;
    font-family: "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
    font-size: 8.8pt;
    font-weight: 450;
    line-height: 1.7;
    text-align: left;
  }
  .footnotes-list { margin: 0; padding-left: 5.5mm; }
  .footnote-item { margin: 0 0 2.5mm; padding-left: 1.5mm; }
  .footnote-item p { margin: 0; orphans: 2; widows: 2; }
  .footnote-backref { display: none; }

  @media print {
    html, body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  }
`;

async function main() {
  const manifest = await loadJson(path.join(projectDir, "generated", "release-manifest.json"));
  const katexCss = await loadKatexCss();
  const book = await renderBook(manifest);
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(manifest.title)} · ${escapeHtml(manifest.editionTitle)}</title>
  <style>${katexCss}\n${css}</style>
</head>
<body>${book}</body>
</html>`;

  await mkdir(path.dirname(htmlPath), { recursive: true });
  await mkdir(path.dirname(pdfPath), { recursive: true });
  await writeFile(htmlPath, html, "utf8");

  if (args.has("--html-only")) {
    console.log(`HTML written to ${htmlPath}`);
    return;
  }

  if (!chromePath) {
    throw new Error("Chrome or Edge was not found. Pass --chrome with an executable path.");
  }

  const chromeArgs = [
    "--headless=new",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-pdf-header-footer",
    "--run-all-compositor-stages-before-draw",
    "--virtual-time-budget=10000",
    `--print-to-pdf=${pdfPath}`,
    pathToFileURL(htmlPath).href,
  ];
  const result = spawnSync(chromePath, chromeArgs, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`PDF generation failed (${result.status}).\n${result.stdout || ""}\n${result.stderr || ""}`);
  }

  console.log(`PDF written to ${pdfPath}`);
  console.log(`Source HTML written to ${htmlPath}`);
}

await main();
