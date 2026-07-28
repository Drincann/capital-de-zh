"use client";

import FingerprintJS from "@fingerprintjs/fingerprintjs";
import { useEffect, useMemo, useRef, useState } from "react";

type ReleaseSection = {
  id: string;
  number: number;
  title: string;
  versionId: string;
  contentPath: string;
};

type ReleaseChapter = {
  id: string;
  number: number;
  title: string;
  available: boolean;
  sections: ReleaseSection[];
};

type ReleasePart = {
  id: string;
  number: number;
  title: string;
  chapters: ReleaseChapter[];
};

type ReleaseManifest = {
  title: string;
  editionTitle: string;
  generatedAt: string;
  partCount: number;
  chapterCount: number;
  sectionCount: number;
  preface?: ReleaseSection;
  parts: ReleasePart[];
};

type ReleaseEntry =
  | (ReleaseSection & {
      kind: "preface";
      part: null;
      chapter: null;
    })
  | (ReleaseSection & {
      kind: "section";
      part: ReleasePart;
      chapter: ReleaseChapter;
    });

type PublishedContent = {
  unitId: string;
  chapterId: string;
  versionId: string;
  title: string;
  html: string;
};

type ParagraphMarker = {
  index: number;
  position: number;
  hitStart: number;
  hitSize: number;
  preview: string;
};

type SavedReadingPosition = {
  sectionId: string;
  paragraphIndex: number;
  offsetRatio: number;
  scrollY: number;
};

const readingPositionKey = "capital-reader-position";
const readingAnchorY = 82;

const fingerprintPromise =
  typeof window === "undefined" ? null : FingerprintJS.load();

function saveReadingPosition(sectionId: string) {
  if (!sectionId) return;
  const paragraphs = Array.from(
    document.querySelectorAll<HTMLElement>("#reading-content .prose p"),
  );
  let paragraphIndex = -1;
  let closestDistance = Number.POSITIVE_INFINITY;
  let offsetRatio = 0;

  paragraphs.forEach((paragraph, index) => {
    const bounds = paragraph.getBoundingClientRect();
    const distance =
      bounds.bottom < readingAnchorY
        ? readingAnchorY - bounds.bottom
        : bounds.top > readingAnchorY
          ? bounds.top - readingAnchorY
          : 0;
    if (distance >= closestDistance) return;
    closestDistance = distance;
    paragraphIndex = index;
    offsetRatio =
      bounds.height > 0
        ? Math.min(
            1,
            Math.max(0, (readingAnchorY - bounds.top) / bounds.height),
          )
        : 0;
  });

  const position: SavedReadingPosition = {
    sectionId,
    paragraphIndex,
    offsetRatio,
    scrollY: window.scrollY,
  };
  sessionStorage.setItem(readingPositionKey, JSON.stringify(position));
}

function scrollWithoutAnimation(top: number) {
  const root = document.documentElement;
  const previousBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = "auto";
  window.scrollTo(0, Math.max(0, top));
  root.style.scrollBehavior = previousBehavior;
}

function restoreReadingPosition(sectionId: string) {
  let position: SavedReadingPosition | null = null;
  try {
    const saved = sessionStorage.getItem(readingPositionKey);
    if (saved) position = JSON.parse(saved) as SavedReadingPosition;
  } catch {
    position = null;
  }

  if (!position || position.sectionId !== sectionId || position.scrollY <= 1) {
    scrollWithoutAnimation(0);
    return;
  }

  const paragraph = document.querySelectorAll<HTMLElement>(
    "#reading-content .prose p",
  )[position.paragraphIndex];
  if (!paragraph) {
    scrollWithoutAnimation(position.scrollY || 0);
    return;
  }

  const bounds = paragraph.getBoundingClientRect();
  scrollWithoutAnimation(
    window.scrollY +
      bounds.top +
      bounds.height * position.offsetRatio -
      readingAnchorY,
  );
}

export function ReaderApp({ release }: { release: ReleaseManifest }) {
  const flatSections = useMemo<ReleaseEntry[]>(
    () => [
      ...(release.preface
        ? [
            {
              ...release.preface,
              kind: "preface" as const,
              part: null,
              chapter: null,
            },
          ]
        : []),
      ...release.parts.flatMap((part) =>
        part.chapters.flatMap((chapter) =>
          chapter.sections.map((section) => ({
            ...section,
            kind: "section" as const,
            part,
            chapter,
          })),
        ),
      ),
    ],
    [release],
  );
  const firstSection = flatSections[0];
  const [selectedId, setSelectedId] = useState(firstSection?.id || "");
  const [loadedContent, setLoadedContent] = useState<{
    sectionId: string;
    value: PublishedContent | null;
    error: string;
  }>({ sectionId: "", value: null, error: "" });
  const [query, setQuery] = useState("");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogCollapsed, setCatalogCollapsed] = useState(false);
  const [catalogWidth, setCatalogWidth] = useState(310);
  const [dark, setDark] = useState(false);
  const [fontScale, setFontScale] = useState(1);
  const [paragraphMarkers, setParagraphMarkers] = useState<ParagraphMarker[]>(
    [],
  );
  const [locationResolved, setLocationResolved] = useState(false);
  const [restoredSectionId, setRestoredSectionId] = useState("");
  const trackedSection = useRef("");
  const readingPosition = useRef<HTMLElement>(null);

  const selectedIndex = flatSections.findIndex(
    (section) => section.id === selectedId,
  );
  const selected = flatSections[selectedIndex] || firstSection;
  const previous = selectedIndex > 0 ? flatSections[selectedIndex - 1] : null;
  const next =
    selectedIndex >= 0 && selectedIndex < flatSections.length - 1
      ? flatSections[selectedIndex + 1]
      : null;
  const loading = Boolean(selected && loadedContent.sectionId !== selected.id);
  const content =
    selected && loadedContent.sectionId === selected.id
      ? loadedContent.value
      : null;
  const contentError =
    selected && loadedContent.sectionId === selected.id
      ? loadedContent.error
      : "";

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const hashId = decodeURIComponent(location.hash.replace(/^#/, ""));
      if ("scrollRestoration" in history) {
        history.scrollRestoration = "manual";
      }
      if (flatSections.some((section) => section.id === hashId)) {
        setSelectedId(hashId);
      }
      setLocationResolved(true);
      const savedTheme = localStorage.getItem("capital-reader-theme");
      const nextDark =
        document.documentElement.dataset.readerTheme === "dark" ||
        (!document.documentElement.dataset.readerTheme &&
          (savedTheme
            ? savedTheme === "dark"
            : matchMedia("(prefers-color-scheme: dark)").matches));
      document.documentElement.dataset.readerTheme = nextDark
        ? "dark"
        : "light";
      setDark(nextDark);
      const savedScale = Number(
        localStorage.getItem("capital-reader-font-scale") || 1,
      );
      if (savedScale >= 0.9 && savedScale <= 1.2) setFontScale(savedScale);
      const savedCatalogWidth = Number(
        localStorage.getItem("capital-reader-catalog-width") || 310,
      );
      if (savedCatalogWidth >= 240 && savedCatalogWidth <= 520) {
        setCatalogWidth(savedCatalogWidth);
      }
      setCatalogCollapsed(
        localStorage.getItem("capital-reader-catalog-collapsed") === "true",
      );
    });
    return () => {
      cancelled = true;
    };
  }, [flatSections]);

  useEffect(() => {
    if (!selected || !locationResolved) return;
    let cancelled = false;
    fetch(selected.contentPath, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("正文暂时无法读取");
        return response.json() as Promise<PublishedContent>;
      })
      .then((value) => {
        if (!cancelled) {
          setLoadedContent({
            sectionId: selected.id,
            value,
            error: "",
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadedContent({
            sectionId: selected.id,
            value: null,
            error:
              error instanceof Error ? error.message : "正文暂时无法读取",
          });
        }
      });

    const currentHashId = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (currentHashId || selected.id !== firstSection?.id) {
      history.replaceState(null, "", `#${encodeURIComponent(selected.id)}`);
    }
    if (trackedSection.current !== selected.id) {
      trackedSection.current = selected.id;
      void trackReadingView();
    }

    return () => {
      cancelled = true;
    };
  }, [firstSection?.id, locationResolved, selected]);

  useEffect(() => {
    let frame = 0;

    function rebuildParagraphMap() {
      frame = 0;
      const blocks = Array.from(
        document.querySelectorAll<HTMLElement>("#reading-content .prose p"),
      );
      const markers = blocks.map((block, index) => {
        const text = block.textContent?.replace(/\s+/g, " ").trim() || "";
        return {
          index,
          position:
            blocks.length <= 1 ? 0.5 : (index + 0.5) / blocks.length,
          hitStart: blocks.length <= 1 ? 0 : index / blocks.length,
          hitSize: 1 / Math.max(1, blocks.length),
          preview: text.length > 108 ? `${text.slice(0, 108)}…` : text,
        };
      });
      setParagraphMarkers(markers);
    }

    frame = requestAnimationFrame(rebuildParagraphMap);
    return () => {
      if (frame) cancelAnimationFrame(frame);
    };
  }, [content]);

  useEffect(() => {
    let frame = 0;

    function updateVisibleParagraphs() {
      frame = 0;
      const position = readingPosition.current;
      if (!position) return;
      const blocks = document.querySelectorAll<HTMLElement>(
        "#reading-content .prose p",
      );
      const markers =
        position.querySelectorAll<HTMLButtonElement>(".paragraph-marker");
      const viewportTop = 68;
      const viewportBottom = window.innerHeight;
      markers.forEach((marker, index) => {
        const bounds = blocks[index]?.getBoundingClientRect();
        marker.classList.toggle(
          "in-viewport",
          Boolean(
            bounds &&
              bounds.bottom >= viewportTop &&
              bounds.top <= viewportBottom,
          ),
        );
      });
    }

    function scheduleUpdate() {
      if (frame) return;
      frame = requestAnimationFrame(updateVisibleParagraphs);
    }

    frame = requestAnimationFrame(updateVisibleParagraphs);
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [paragraphMarkers]);

  useEffect(() => {
    if (!content || !selected) return;
    let outerFrame = 0;
    let innerFrame = 0;
    outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        restoreReadingPosition(selected.id);
        setRestoredSectionId(selected.id);
      });
    });
    return () => {
      if (outerFrame) cancelAnimationFrame(outerFrame);
      if (innerFrame) cancelAnimationFrame(innerFrame);
    };
  }, [content, selected]);

  useEffect(() => {
    if (!content || !selected || restoredSectionId !== selected.id) return;
    const sectionId = selected.id;
    let frame = 0;

    function persist() {
      frame = 0;
      saveReadingPosition(sectionId);
    }

    function schedulePersist() {
      if (frame) return;
      frame = requestAnimationFrame(persist);
    }

    window.addEventListener("scroll", schedulePersist, { passive: true });
    window.addEventListener("pagehide", persist);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedulePersist);
      window.removeEventListener("pagehide", persist);
    };
  }, [content, restoredSectionId, selected]);

  const filteredParts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return release.parts;
    return release.parts
      .map((part) => {
        const partMatches = part.title.toLowerCase().includes(normalized);
        return {
          ...part,
          chapters: part.chapters
            .map((chapter) => ({
              ...chapter,
              sections: chapter.sections.filter((section) =>
                `${part.title} ${chapter.title} ${section.title}`
                  .toLowerCase()
                  .includes(normalized),
              ),
            }))
            .filter(
              (chapter) =>
                partMatches ||
                chapter.sections.length > 0 ||
                chapter.title.toLowerCase().includes(normalized),
            ),
        };
      })
      .filter((part) => part.chapters.length > 0);
  }, [query, release.parts]);

  function choose(sectionId: string) {
    sessionStorage.removeItem(readingPositionKey);
    setRestoredSectionId("");
    setSelectedId(sectionId);
    setCatalogOpen(false);
  }

  function toggleTheme() {
    const nextValue = !dark;
    setDark(nextValue);
    document.documentElement.dataset.readerTheme = nextValue
      ? "dark"
      : "light";
    localStorage.setItem(
      "capital-reader-theme",
      nextValue ? "dark" : "light",
    );
  }

  function changeFont(delta: number) {
    const nextValue = Math.min(1.2, Math.max(0.9, fontScale + delta));
    setFontScale(Number(nextValue.toFixed(2)));
    localStorage.setItem("capital-reader-font-scale", String(nextValue));
  }

  function toggleCatalog() {
    if (matchMedia("(max-width: 900px)").matches) {
      setCatalogOpen((value) => !value);
      return;
    }
    const nextValue = !catalogCollapsed;
    setCatalogCollapsed(nextValue);
    localStorage.setItem(
      "capital-reader-catalog-collapsed",
      String(nextValue),
    );
  }

  function resizeCatalog(nextWidth: number) {
    setCatalogWidth(Math.min(520, Math.max(240, nextWidth)));
  }

  function startCatalogResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = catalogWidth;

    function onMove(moveEvent: PointerEvent) {
      resizeCatalog(startWidth + moveEvent.clientX - startX);
    }

    function onEnd(endEvent: PointerEvent) {
      const nextWidth = Math.min(
        520,
        Math.max(240, startWidth + endEvent.clientX - startX),
      );
      setCatalogWidth(nextWidth);
      localStorage.setItem(
        "capital-reader-catalog-width",
        String(nextWidth),
      );
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
  }

  function navigateFootnote(event: React.MouseEvent<HTMLDivElement>) {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>(
      'a[href^="#fn"]',
    );
    if (!link) return;

    const destination = document.getElementById(
      decodeURIComponent(link.hash.slice(1)),
    );
    if (!destination) return;

    event.preventDefault();
    const highlightTarget =
      destination.closest<HTMLElement>(".footnote-ref") || destination;
    const reducedMotion = matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let fallbackTimer = 0;
    let highlighted = false;

    function showHighlight() {
      if (highlighted) return;
      highlighted = true;
      window.clearTimeout(fallbackTimer);
      window.removeEventListener("scrollend", showHighlight);
      highlightTarget.classList.remove("footnote-pulse");
      void highlightTarget.offsetWidth;
      highlightTarget.classList.add("footnote-pulse");
      window.setTimeout(() => {
        highlightTarget.classList.remove("footnote-pulse");
      }, 2400);
    }

    destination.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
    });
    if (reducedMotion) {
      requestAnimationFrame(showHighlight);
    } else {
      window.addEventListener("scrollend", showHighlight, { once: true });
      fallbackTimer = window.setTimeout(showHighlight, 900);
    }
  }

  function scrollToParagraph(index: number) {
    const paragraph = document.querySelectorAll<HTMLElement>(
      "#reading-content .prose p",
    )[index];
    paragraph?.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "center",
    });
  }

  if (!selected) {
    return <main className="empty-state">尚未发布可阅读的章节。</main>;
  }

  return (
    <div className={dark ? "reader-shell theme-dark" : "reader-shell"}>
      <header className="topbar">
        <button
          className="catalog-toggle"
          type="button"
          onClick={toggleCatalog}
          aria-label="显示或收起目录"
        >
          目录
        </button>
        <a
          className="brand"
          href={`#${encodeURIComponent(firstSection.id)}`}
          aria-label="返回译者序"
          onClick={(event) => {
            event.preventDefault();
            choose(firstSection.id);
          }}
        >
          <span>{release.title}</span>
          <small>{release.editionTitle}</small>
        </a>
        <div className="reading-tools">
          <button type="button" onClick={() => changeFont(-0.05)}>
            小
          </button>
          <button type="button" onClick={() => changeFont(0.05)}>
            大
          </button>
          <button type="button" onClick={toggleTheme}>
            {dark ? "浅色" : "深色"}
          </button>
          <a
            className="github-link"
            href="https://github.com/Drincann/capital-de-zh"
            target="_blank"
            rel="noreferrer"
            aria-label="在 GitHub 查看项目"
            title="GitHub"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path
                fill="currentColor"
                d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.49 0-.24-.01-1.04-.02-1.89-2.78.62-3.37-1.2-3.37-1.2-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .08 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.85.09-.66.35-1.12.64-1.37-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.96a9.3 9.3 0 0 1 2.5.35c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.57 5.04.36.32.68.95.68 1.92 0 1.38-.01 2.49-.01 2.83 0 .27.18.6.69.49A10.25 10.25 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z"
              />
            </svg>
          </a>
        </div>
      </header>
      <nav
        ref={readingPosition}
        className={
          paragraphMarkers.length
            ? "reading-position"
            : "reading-position reading-position-hidden"
        }
        aria-label="正文段落定位"
      >
        {paragraphMarkers.map((marker) => (
          <button
            type="button"
            key={marker.index}
            className={`paragraph-marker${
              marker.position < 0.1
                ? " near-start"
                : marker.position > 0.9
                  ? " near-end"
                  : ""
            }`}
            style={
              {
                "--paragraph-position": marker.position,
                "--paragraph-hit-start": marker.hitStart,
                "--paragraph-hit-size": marker.hitSize,
              } as React.CSSProperties
            }
            onClick={() => scrollToParagraph(marker.index)}
            aria-label={`跳到第 ${marker.index + 1} 段：${marker.preview}`}
          >
            <span className="paragraph-line" aria-hidden="true" />
            <span className="paragraph-tooltip" aria-hidden="true">
              <span>{marker.preview}</span>
            </span>
          </button>
        ))}
      </nav>

      <div
        className={
          catalogCollapsed
            ? "reader-layout catalog-collapsed"
            : "reader-layout"
        }
        style={
          {
            "--catalog-width": `${catalogWidth}px`,
          } as React.CSSProperties
        }
      >
        <aside className={catalogOpen ? "catalog catalog-open" : "catalog"}>
          <div className="catalog-head">
            <strong>目录</strong>
            <span>{release.sectionCount} 节</span>
          </div>
          <label className="catalog-search">
            <span className="sr-only">搜索目录</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索章节"
            />
          </label>
          <nav aria-label="全书目录">
            {release.preface &&
            (!query.trim() || release.preface.title.includes(query.trim())) ? (
              <div className="catalog-preface catalog-sections">
                <button
                  type="button"
                  className={release.preface.id === selected.id ? "active" : ""}
                  onClick={() => choose(release.preface!.id)}
                  title={release.preface.title}
                >
                  <span className="section-number">序</span>
                  <span className="section-title">
                    {release.preface.title}
                  </span>
                </button>
              </div>
            ) : null}
            {filteredParts.map((part) => (
              <section className="catalog-part" key={part.id}>
                <h2 title={`第${part.number}篇 ${part.title}`}>
                  第{part.number}篇 <span>{part.title}</span>
                </h2>
                {part.chapters.map((chapter) => (
                  <div
                    className={`catalog-chapter${
                      chapter.available ? "" : " catalog-chapter-upcoming"
                    }`}
                    key={chapter.id}
                  >
                    <h3
                      title={
                        chapter.available
                          ? `第${chapter.number}章 ${chapter.title}`
                          : undefined
                      }
                      aria-disabled={chapter.available ? undefined : true}
                      tabIndex={chapter.available ? undefined : 0}
                    >
                      <span className="catalog-chapter-label">
                        第{chapter.number}章 {chapter.title}
                      </span>
                      {!chapter.available ? (
                        <span
                          className="catalog-chapter-tooltip"
                          role="tooltip"
                        >
                          本章尚未完成翻译，完成后将在这里开放。
                        </span>
                      ) : null}
                    </h3>
                    {chapter.available ? (
                      <div className="catalog-sections">
                        {chapter.sections.map((section) => (
                          <button
                            type="button"
                            key={section.id}
                            className={
                              section.id === selected.id ? "active" : ""
                            }
                            onClick={() => choose(section.id)}
                            title={section.title}
                          >
                            <span className="section-number">
                              {section.number}
                            </span>
                            <span className="section-title">
                              {section.title}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </section>
            ))}
          </nav>
        </aside>
        <div
          className="catalog-resizer"
          role="separator"
          aria-label="调整目录宽度"
          aria-orientation="vertical"
          aria-valuemin={240}
          aria-valuemax={520}
          aria-valuenow={catalogWidth}
          tabIndex={0}
          onPointerDown={startCatalogResize}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
              return;
            }
            event.preventDefault();
            const nextWidth =
              catalogWidth + (event.key === "ArrowRight" ? 16 : -16);
            resizeCatalog(nextWidth);
            localStorage.setItem(
              "capital-reader-catalog-width",
              String(Math.min(520, Math.max(240, nextWidth))),
            );
          }}
        />

        {catalogOpen ? (
          <button
            className="catalog-backdrop"
            type="button"
            onClick={() => setCatalogOpen(false)}
            aria-label="关闭目录"
          />
        ) : null}

        <main id="reading-content" className="reading-pane">
          <article
            className="reading-article"
            style={{ "--reader-scale": fontScale } as React.CSSProperties}
          >
            {selected.kind === "preface" ? (
              <>
                <div className="reading-context">
                  <span>{release.title}</span>
                </div>
                <h1>{selected.title}</h1>
              </>
            ) : (
              <>
                <div className="reading-context">
                  <span>
                    第{selected.part.number}篇 · 第{selected.chapter.number}章
                  </span>
                </div>
                <h1>{selected.chapter.title}</h1>
                <h2>{selected.title}</h2>
              </>
            )}

            {loading ? (
              <div className="reading-loading" role="status">
                正在载入正文…
              </div>
            ) : contentError ? (
              <div className="reading-error">{contentError}</div>
            ) : (
              <div
                className="prose"
                onClick={navigateFootnote}
                dangerouslySetInnerHTML={{ __html: content?.html || "" }}
              />
            )}

            <nav className="page-turn" aria-label="前后章节">
              {previous ? (
                <button type="button" onClick={() => choose(previous.id)}>
                  <small>上一节</small>
                  <span>{previous.title}</span>
                </button>
              ) : (
                <span />
              )}
              {next ? (
                <button type="button" onClick={() => choose(next.id)}>
                  <small>下一节</small>
                  <span>{next.title}</span>
                </button>
              ) : (
                <span />
              )}
            </nav>
          </article>
        </main>
      </div>
    </div>
  );
}

async function trackReadingView() {
  let fingerprintHint = "";
  try {
    const agent = await fingerprintPromise;
    const result = await agent?.get();
    fingerprintHint = result?.visitorId || "";
  } catch {
    fingerprintHint = "";
  }

  await fetch("/api/analytics/track", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fingerprintHint }),
  }).catch(() => undefined);
}
