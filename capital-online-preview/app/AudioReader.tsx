"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type NarrationSentence = {
  id: string;
  index: number;
  paragraphIndex: number;
  text: string;
};

type AudioSentence = {
  id: string;
  text: string;
  chunk_id: string;
  start_ms: number;
  end_ms: number;
};

type AudioChunk = {
  id: string;
  audio_file: string;
  duration_ms: number;
  sentence_ids: string[];
};

type AudioManifest = {
  status: "ready";
  audio_version_id: string;
  unit_id: string;
  translation_version_id: string;
  translation_sha256: string;
  duration_ms: number;
  chunks: AudioChunk[];
  sentences: AudioSentence[];
};

const sentencePattern = /[^。！？!?]+(?:[。！？!?]+[”’」』》）)]*)|[^。！？!?]+$/g;
const maximumSentenceCharacters = 220;

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function rawSentenceRanges(value: string) {
  const matches = Array.from(value.matchAll(sentencePattern));
  const ranges: Array<{ start: number; end: number; text: string }> = [];
  for (const match of matches) {
    let start = match.index || 0;
    const end = start + match[0].length;
    while (end - start > maximumSentenceCharacters) {
      const windowEnd = Math.min(end, start + maximumSentenceCharacters + 1);
      const window = value.slice(start, windowEnd);
      let cut = -1;
      for (const punctuation of ["；", ";", "：", ":", "，", ","]) {
        cut = Math.max(cut, window.lastIndexOf(punctuation));
      }
      if (cut < Math.floor(maximumSentenceCharacters * 0.55)) {
        cut = maximumSentenceCharacters;
      } else {
        cut += 1;
      }
      ranges.push({
        start,
        end: start + cut,
        text: normalize(value.slice(start, start + cut)),
      });
      start += cut;
      while (/\s/.test(value[start] || "")) start += 1;
    }
    if (normalize(value.slice(start, end))) {
      ranges.push({ start, end, text: normalize(value.slice(start, end)) });
    }
  }
  return ranges;
}

function decorateArticle(
  sentences: NarrationSentence[],
  ready: boolean,
  onActivate: (sentenceId: string) => void,
) {
  const prose = document.querySelector<HTMLElement>("#reading-content .prose");
  if (!prose) return () => {};
  prose.classList.toggle("narration-ready", ready);
  const paragraphs = Array.from(prose.querySelectorAll<HTMLElement>("p")).filter(
    (paragraph) => !paragraph.closest(".footnotes"),
  );
  const created: HTMLElement[] = [];
  const companions: HTMLElement[] = [];

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const expected = sentences.filter(
      (sentence) => sentence.paragraphIndex === paragraphIndex,
    );
    if (!expected.length) return;

    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let node = walker.nextNode();
    while (node) {
      const textNode = node as Text;
      const parent = textNode.parentElement;
      if (!parent?.closest(".footnote-ref, .katex")) nodes.push(textNode);
      node = walker.nextNode();
    }
    const offsets: Array<{ node: Text; start: number; end: number }> = [];
    let total = 0;
    for (const textNode of nodes) {
      offsets.push({ node: textNode, start: total, end: total + textNode.data.length });
      total += textNode.data.length;
    }
    const raw = nodes.map((textNode) => textNode.data).join("");
    const ranges = rawSentenceRanges(raw);
    const usable = Math.min(ranges.length, expected.length);

    offsets.forEach(({ node: textNode, start: nodeStart, end: nodeEnd }) => {
      const fragment = document.createDocumentFragment();
      let cursor = nodeStart;
      for (let index = 0; index < usable; index += 1) {
        const range = ranges[index];
        const start = Math.max(nodeStart, range.start);
        const end = Math.min(nodeEnd, range.end);
        if (end <= start) continue;
        if (start > cursor) {
          fragment.append(textNode.data.slice(cursor - nodeStart, start - nodeStart));
        }
        const span = document.createElement("span");
        span.dataset.narrationSentence = expected[index].id;
        span.textContent = textNode.data.slice(start - nodeStart, end - nodeStart);
        const primary = !paragraph.querySelector(
          `[data-narration-sentence="${expected[index].id}"]`,
        );
        if (primary && ready) {
          span.dataset.narrationPrimary = "true";
          span.tabIndex = 0;
          span.setAttribute("role", "button");
          span.setAttribute("aria-label", `从这里朗读：${expected[index].text}`);
          const activate = (event: Event) => {
            if (
              event instanceof KeyboardEvent &&
              !["Enter", " "].includes(event.key)
            ) {
              return;
            }
            event.preventDefault();
            onActivate(expected[index].id);
          };
          span.addEventListener("click", activate);
          span.addEventListener("keydown", activate);
        }
        created.push(span);
        fragment.append(span);
        cursor = end;
      }
      if (cursor < nodeEnd) {
        fragment.append(textNode.data.slice(cursor - nodeStart));
      }
      textNode.replaceWith(fragment);
    });

    const decorated = Array.from(
      paragraph.querySelectorAll<HTMLElement>(
        "[data-narration-sentence], .katex",
      ),
    );
    decorated.forEach((element, index) => {
      if (!element.classList.contains("katex")) return;
      const previous = decorated
        .slice(0, index)
        .reverse()
        .find((candidate) => candidate.dataset.narrationSentence);
      const next = decorated
        .slice(index + 1)
        .find((candidate) => candidate.dataset.narrationSentence);
      const previousId = previous?.dataset.narrationSentence;
      const nextId = next?.dataset.narrationSentence;
      if (!previousId || previousId !== nextId) return;
      element.dataset.narrationCompanion = previousId;
      companions.push(element);
    });
  });

  return () => {
    prose.classList.remove("narration-ready");
    companions.forEach((element) => {
      delete element.dataset.narrationCompanion;
      element.classList.remove("narration-current");
    });
    created.forEach((span) => span.replaceWith(span.textContent || ""));
    prose.normalize();
  };
}

function formatTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const playbackRates = [0.75, 1, 1.25, 1.5, 2];

function PlaybackRatePicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const selectedIndex = Math.max(0, playbackRates.indexOf(value));

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      optionRefs.current[selectedIndex]?.focus();
    });
    const closeFromOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeFromOutside);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", closeFromOutside);
    };
  }, [open, selectedIndex]);

  function choose(next: number) {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="narration-rate-picker" ref={rootRef}>
      <button
        className="narration-rate-trigger"
        ref={triggerRef}
        type="button"
        aria-label={`播放速率，当前 ${value} 倍`}
        aria-haspopup="listbox"
        aria-controls={menuId}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>{value}×</span>
        <i aria-hidden="true" />
      </button>
      <div
        className="narration-rate-menu"
        id={menuId}
        role="listbox"
        aria-label="选择播放速率"
        hidden={!open}
        onKeyDown={(event) => {
          const currentIndex = optionRefs.current.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          let nextIndex = currentIndex;
          if (event.key === "ArrowDown") nextIndex = currentIndex + 1;
          else if (event.key === "ArrowUp") nextIndex = currentIndex - 1;
          else if (event.key === "Home") nextIndex = 0;
          else if (event.key === "End") nextIndex = playbackRates.length - 1;
          else if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            triggerRef.current?.focus();
            return;
          } else return;
          event.preventDefault();
          const wrapped =
            (nextIndex + playbackRates.length) % playbackRates.length;
          optionRefs.current[wrapped]?.focus();
        }}
      >
        {playbackRates.map((rate) => (
          <button
            className="narration-rate-option"
            ref={(element) => {
              optionRefs.current[playbackRates.indexOf(rate)] = element;
            }}
            key={rate}
            type="button"
            role="option"
            aria-selected={rate === value}
            onClick={() => choose(rate)}
          >
            <span>{rate}×</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function AudioReader({
  sectionId,
  versionId,
  translationSha256,
  title,
  audioManifestPath,
  sentences,
}: {
  sectionId: string;
  versionId: string;
  translationSha256: string;
  title: string;
  audioManifestPath?: string;
  sentences: NarrationSentence[];
}) {
  const [manifest, setManifest] = useState<AudioManifest | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">(
    audioManifestPath ? "loading" : "missing",
  );
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [activeSentenceId, setActiveSentenceId] = useState("");
  const [activeChunkId, setActiveChunkId] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [rate, setRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement>(null);
  const pendingStart = useRef<{ chunkId: string; time: number; autoplay: boolean } | null>(null);
  const playSentenceRef = useRef<(sentenceId: string) => void>(() => {});
  const manifestUrl = useMemo(
    () =>
      audioManifestPath && typeof window !== "undefined"
        ? new URL(audioManifestPath, window.location.origin).href
        : "",
    [audioManifestPath],
  );

  const chunkOffsets = useMemo(() => {
    const result = new Map<string, number>();
    let elapsed = 0;
    for (const chunk of manifest?.chunks || []) {
      result.set(chunk.id, elapsed);
      elapsed += chunk.duration_ms;
    }
    return result;
  }, [manifest]);

  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
  }, []);

  useEffect(() => {
    setManifest(null);
    setStarted(false);
    setPlaying(false);
    setActiveSentenceId("");
    setActiveChunkId("");
    setElapsedMs(0);
    if (!audioManifestPath) {
      setStatus("missing");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    fetch(audioManifestPath, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("语音清单不可用");
        return response.json() as Promise<AudioManifest>;
      })
      .then((value) => {
        if (cancelled) return;
        if (
          value.status !== "ready" ||
          value.unit_id !== sectionId ||
          value.translation_version_id !== versionId ||
          value.translation_sha256 !== translationSha256
        ) {
          throw new Error("语音与当前译文版本不一致");
        }
        setManifest(value);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [audioManifestPath, sectionId, translationSha256, versionId]);

  useEffect(
    () =>
      decorateArticle(sentences, status === "ready", (sentenceId) =>
        playSentenceRef.current(sentenceId),
      ),
    [sentences, status],
  );

  useEffect(() => {
    document
      .querySelectorAll(
        "[data-narration-sentence], [data-narration-companion]",
      )
      .forEach((element) => {
        const sentenceId =
          element.getAttribute("data-narration-sentence") ||
          element.getAttribute("data-narration-companion");
        element.classList.toggle(
          "narration-current",
          sentenceId === activeSentenceId,
        );
      });
    if (!activeSentenceId) return;
    const primary = document.querySelector<HTMLElement>(
      `[data-narration-sentence="${activeSentenceId}"]`,
    );
    const bounds = primary?.getBoundingClientRect();
    if (bounds && (bounds.top < 64 || bounds.bottom > window.innerHeight - 112)) {
      primary?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "center",
      });
    }
  }, [activeSentenceId]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: "《资本论》第一卷 · ChatGPT 译",
      album: "语音阅读",
    });
    navigator.mediaSession.setActionHandler("play", () => void resume());
    navigator.mediaSession.setActionHandler("pause", pause);
    navigator.mediaSession.setActionHandler("previoustrack", previousSentence);
    navigator.mediaSession.setActionHandler("nexttrack", nextSentence);
    return () => {
      for (const action of ["play", "pause", "previoustrack", "nexttrack"] as MediaSessionAction[]) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {}
      }
    };
  });

  function chunkUrl(chunk: AudioChunk) {
    return new URL(chunk.audio_file, manifestUrl).href;
  }

  function loadChunk(chunkId: string, time: number, autoplay: boolean) {
    const audio = audioRef.current;
    const chunk = manifest?.chunks.find((item) => item.id === chunkId);
    if (!audio || !chunk) return;
    setStarted(true);
    setActiveChunkId(chunkId);
    pendingStart.current = { chunkId, time, autoplay };
    const source = chunkUrl(chunk);
    if (audio.src !== source) {
      audio.src = source;
      audio.load();
    } else {
      audio.currentTime = time;
      pendingStart.current = null;
      if (autoplay) void audio.play();
    }
  }

  async function playSentence(sentenceId: string) {
    const sentence = manifest?.sentences.find((item) => item.id === sentenceId);
    if (!sentence) return;
    setActiveSentenceId(sentence.id);
    loadChunk(sentence.chunk_id, sentence.start_ms / 1000, true);
  }

  playSentenceRef.current = (sentenceId) => {
    void playSentence(sentenceId);
  };

  function firstVisibleSentenceId() {
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>("[data-narration-primary]"),
    );
    return (
      elements.find((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.bottom > 64 && bounds.top < window.innerHeight * 0.72;
      })?.dataset.narrationSentence || manifest?.sentences[0]?.id || ""
    );
  }

  async function resume() {
    const audio = audioRef.current;
    if (started && audio?.src) {
      await audio.play();
      return;
    }
    await playSentence(firstVisibleSentenceId());
  }

  function pause() {
    audioRef.current?.pause();
  }

  function sentenceStep(direction: number) {
    const list = manifest?.sentences || [];
    const index = Math.max(
      0,
      list.findIndex((sentence) => sentence.id === activeSentenceId),
    );
    const next = list[Math.min(list.length - 1, Math.max(0, index + direction))];
    if (next) void playSentence(next.id);
  }

  function previousSentence() {
    sentenceStep(-1);
  }

  function nextSentence() {
    sentenceStep(1);
  }

  function updatePlayback() {
    const audio = audioRef.current;
    if (!audio || !manifest || !activeChunkId) return;
    const localMs = audio.currentTime * 1000;
    setElapsedMs((chunkOffsets.get(activeChunkId) || 0) + localMs);
    const active = manifest.sentences.find(
      (sentence) =>
        sentence.chunk_id === activeChunkId &&
        localMs >= sentence.start_ms - 80 &&
        localMs < sentence.end_ms + 180,
    );
    if (active && active.id !== activeSentenceId) setActiveSentenceId(active.id);
    const chunkIndex = manifest.chunks.findIndex((item) => item.id === activeChunkId);
    if (audio.currentTime > 2 && chunkIndex >= 0) {
      const nextChunk = manifest.chunks[chunkIndex + 1];
      if (nextChunk) {
        const linkId = `audio-prefetch-${nextChunk.id}`;
        if (!document.getElementById(linkId)) {
          const link = document.createElement("link");
          link.id = linkId;
          link.rel = "prefetch";
          link.as = "audio";
          link.href = chunkUrl(nextChunk);
          document.head.append(link);
        }
      }
    }
  }

  function continueToNextChunk() {
    const chunks = manifest?.chunks || [];
    const index = chunks.findIndex((chunk) => chunk.id === activeChunkId);
    const next = chunks[index + 1];
    if (!next) {
      setPlaying(false);
      return;
    }
    const firstSentence = manifest?.sentences.find(
      (sentence) => sentence.chunk_id === next.id,
    );
    if (firstSentence) setActiveSentenceId(firstSentence.id);
    loadChunk(next.id, 0, true);
  }

  function seekGlobal(milliseconds: number) {
    if (!manifest) return;
    let offset = 0;
    for (const chunk of manifest.chunks) {
      if (milliseconds <= offset + chunk.duration_ms) {
        loadChunk(chunk.id, (milliseconds - offset) / 1000, playing);
        return;
      }
      offset += chunk.duration_ms;
    }
  }

  const activeText =
    manifest?.sentences.find((sentence) => sentence.id === activeSentenceId)?.text ||
    "点正文中的任一句开始朗读";

  return (
    <>
      <div className={`narration-availability ${status}`}>
        {status === "ready" ? (
          <button type="button" onClick={() => void resume()}>
            <span aria-hidden="true">▶</span> 朗读本节
          </button>
        ) : status === "loading" ? (
          <span>正在准备语音…</span>
        ) : (
          <span>暂无语音</span>
        )}
      </div>
      <audio
        ref={audioRef}
        preload="metadata"
        onLoadedMetadata={() => {
          const pending = pendingStart.current;
          const audio = audioRef.current;
          const pendingChunk = manifest?.chunks.find(
            (chunk) => chunk.id === pending?.chunkId,
          );
          if (
            !pending ||
            !audio ||
            !pendingChunk ||
            audio.src !== chunkUrl(pendingChunk)
          ) {
            return;
          }
          audio.currentTime = Math.min(pending.time, Math.max(0, audio.duration - 0.05));
          pendingStart.current = null;
          if (pending.autoplay) void audio.play();
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={updatePlayback}
        onEnded={continueToNextChunk}
        onError={() => setPlaying(false)}
      />
      {status === "ready" && started ? (
        <section className="narration-player" aria-label="语音阅读控制">
          <div className="narration-progress-row">
            <span>{formatTime(elapsedMs)}</span>
            <input
              type="range"
              min="0"
              max={manifest?.duration_ms || 1}
              value={Math.min(elapsedMs, manifest?.duration_ms || 1)}
              onChange={(event) => seekGlobal(Number(event.target.value))}
              aria-label="朗读进度"
            />
            <span>{formatTime(manifest?.duration_ms || 0)}</span>
          </div>
          <div className="narration-controls">
            <button type="button" onClick={previousSentence} aria-label="上一句">‹</button>
            <button
              className="narration-play"
              type="button"
              onClick={playing ? pause : () => void resume()}
              aria-label={playing ? "暂停" : "继续播放"}
            >
              <span
                className={`narration-play-icon ${playing ? "is-pause" : "is-play"}`}
                aria-hidden="true"
              >
                <span />
                {playing ? <span /> : null}
              </span>
            </button>
            <button type="button" onClick={nextSentence} aria-label="下一句">›</button>
            <p title={activeText}>{activeText}</p>
            <PlaybackRatePicker
              value={rate}
              onChange={(next) => {
                setRate(next);
                if (audioRef.current) audioRef.current.playbackRate = next;
              }}
            />
          </div>
        </section>
      ) : null}
    </>
  );
}
