"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ReaderViewer = {
  signedIn: boolean;
  isOwner: boolean;
  displayName: string;
  signInHref: string;
  signOutHref: string;
};

type NoteColor = "amber" | "rose" | "sage" | "blue";

type ReaderNote = {
  id: string;
  sectionId: string;
  versionId: string;
  quote: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
  body: string;
  color: NoteColor;
  createdAt: string;
  updatedAt: string;
};

type SelectionCandidate = {
  quote: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
  top: number;
  left: number;
  overlappingNoteId: string;
};

type SaveState = "idle" | "saving" | "saved" | "error";

const colors: Array<{ value: NoteColor; label: string }> = [
  { value: "amber", label: "琥珀" },
  { value: "rose", label: "玫瑰" },
  { value: "sage", label: "鼠尾草" },
  { value: "blue", label: "靛青" },
];

export function ReaderNotes({
  sectionId,
  versionId,
  viewer,
  contentReady,
}: {
  sectionId: string;
  versionId: string;
  viewer: ReaderViewer;
  contentReady: boolean;
}) {
  const [notes, setNotes] = useState<ReaderNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeNoteId, setActiveNoteId] = useState("");
  const [candidate, setCandidate] = useState<SelectionCandidate | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [draftColor, setDraftColor] = useState<NoteColor>("amber");
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const revision = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  const activeNote = useMemo(
    () => notes.find((note) => note.id === activeNoteId) || null,
    [activeNoteId, notes],
  );

  const openExisting = useCallback(
    (noteId: string) => {
      const note = notes.find((item) => item.id === noteId);
      if (note && noteId !== activeNoteId) {
        setDraftBody(note.body);
        setDraftColor(note.color);
        setDirty(false);
        setSaveState("idle");
        setDeleteArmed(false);
        revision.current += 1;
      }
      setActiveNoteId(noteId);
      setPanelOpen(true);
    },
    [activeNoteId, notes],
  );

  useEffect(() => {
    if (!sectionId) return;
    let cancelled = false;

    fetch(`/api/notes?sectionId=${encodeURIComponent(sectionId)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const value = (await response.json().catch(() => ({}))) as {
          notes?: ReaderNote[];
          error?: string;
        };
        if (!response.ok) throw new Error(value.error || "笔记暂时无法读取");
        return value.notes || [];
      })
      .then((value) => {
        if (!cancelled) setNotes(value);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "笔记暂时无法读取",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sectionId]);

  useEffect(() => {
    document.body.classList.toggle("notes-panel-open", panelOpen);
    return () => document.body.classList.remove("notes-panel-open");
  }, [panelOpen]);

  useEffect(() => {
    if (!contentReady) return;
    const frame = requestAnimationFrame(() => {
      const root = noteRoot();
      if (root) applyHighlights(root, notes);
    });
    return () => cancelAnimationFrame(frame);
  }, [contentReady, notes, sectionId, versionId]);

  useEffect(() => {
    if (!contentReady) return;
    const root = noteRoot();
    if (!root) return;

    function openFromHighlight(event: Event) {
      const target = event.target as HTMLElement | null;
      const mark = target?.closest<HTMLElement>("[data-reader-note-id]");
      if (!mark || !root!.contains(mark)) return;
      const noteId = mark.dataset.readerNoteId || "";
      if (!noteId) return;
      event.preventDefault();
      setCandidate(null);
      openExisting(noteId);
    }

    function openFromKeyboard(event: KeyboardEvent) {
      if (event.key !== "Enter" && event.key !== " ") return;
      openFromHighlight(event);
    }

    root.addEventListener("click", openFromHighlight);
    root.addEventListener("keydown", openFromKeyboard);
    return () => {
      root.removeEventListener("click", openFromHighlight);
      root.removeEventListener("keydown", openFromKeyboard);
    };
  }, [contentReady, notes, openExisting]);

  useEffect(() => {
    if (!viewer.isOwner || !contentReady) return;
    const root = noteRoot();
    if (!root) return;
    let timer = 0;

    function captureSoon() {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const next = captureSelection(root!, notes);
        setCandidate(next);
      }, 40);
    }

    function clearOnOutsidePointer(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          ".selection-note-action, .notes-panel, [data-reader-note-id]",
        )
      ) {
        return;
      }
      if (!root!.contains(target)) setCandidate(null);
    }

    root.addEventListener("mouseup", captureSoon);
    root.addEventListener("touchend", captureSoon, { passive: true });
    document.addEventListener("pointerdown", clearOnOutsidePointer);
    return () => {
      window.clearTimeout(timer);
      root.removeEventListener("mouseup", captureSoon);
      root.removeEventListener("touchend", captureSoon);
      document.removeEventListener("pointerdown", clearOnOutsidePointer);
    };
  }, [contentReady, notes, viewer.isOwner]);

  useEffect(() => {
    if (!deleteArmed) return;
    const timer = window.setTimeout(() => setDeleteArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [deleteArmed]);

  function startDraft() {
    if (!candidate) return;
    if (candidate.overlappingNoteId) {
      openExisting(candidate.overlappingNoteId);
      setCandidate(null);
      window.getSelection()?.removeAllRanges();
      return;
    }
    setActiveNoteId("");
    setDraftBody("");
    setDraftColor("amber");
    setDirty(false);
    setSaveState("idle");
    setPanelOpen(true);
    window.getSelection()?.removeAllRanges();
  }

  function changeBody(value: string) {
    setDraftBody(value);
    setDirty(true);
    setSaveState("idle");
    revision.current += 1;
  }

  function changeColor(value: NoteColor) {
    setDraftColor(value);
    setDirty(true);
    setSaveState("idle");
    revision.current += 1;
  }

  async function createNote() {
    if (!candidate || saveState === "saving") return;
    setSaveState("saving");
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sectionId,
          versionId,
          quote: candidate.quote,
          prefix: candidate.prefix,
          suffix: candidate.suffix,
          startOffset: candidate.startOffset,
          endOffset: candidate.endOffset,
          body: draftBody,
          color: draftColor,
        }),
      });
      const value = (await response.json().catch(() => ({}))) as {
        note?: ReaderNote;
        error?: string;
      };
      if (!response.ok || !value.note) {
        throw new Error(value.error || "保存失败");
      }
      setNotes((current) => [...current, value.note!]);
      setActiveNoteId(value.note.id);
      setCandidate(null);
      setDirty(false);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  const saveExisting = useCallback(
    async (
      noteId = activeNoteId,
      snapshotRevision = revision.current,
    ) => {
      if (!noteId) return;
      const body = draftBody;
      const color = draftColor;
      setSaveState("saving");
      const queuedSave = saveQueue.current.then(async () => {
        const response = await fetch("/api/notes", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: noteId, body, color }),
        });
        const value = (await response.json().catch(() => ({}))) as {
          note?: ReaderNote;
          error?: string;
        };
        if (!response.ok || !value.note) {
          throw new Error(value.error || "保存失败");
        }
        setNotes((current) =>
          current.map((note) => (note.id === noteId ? value.note! : note)),
        );
        if (revision.current === snapshotRevision) {
          setDirty(false);
          setSaveState("saved");
        } else {
          setSaveState("idle");
        }
      });
      saveQueue.current = queuedSave.catch(() => undefined);
      try {
        await queuedSave;
      } catch {
        setSaveState("error");
      }
    },
    [activeNoteId, draftBody, draftColor],
  );

  useEffect(() => {
    if (!viewer.isOwner || !activeNoteId || !dirty) return;
    const snapshotRevision = revision.current;
    const timer = window.setTimeout(() => {
      void saveExisting(activeNoteId, snapshotRevision);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [activeNoteId, dirty, saveExisting, viewer.isOwner]);

  async function deleteNote() {
    if (!activeNote) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setDeleteArmed(false);
    setSaveState("saving");
    try {
      const response = await fetch("/api/notes", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: activeNote.id }),
      });
      if (!response.ok) throw new Error("删除失败");
      setNotes((current) =>
        current.filter((note) => note.id !== activeNote.id),
      );
      setActiveNoteId("");
      setDraftBody("");
      setPanelOpen(true);
      setSaveState("idle");
    } catch {
      setSaveState("error");
    }
  }

  function closeEditor() {
    setActiveNoteId("");
    setCandidate(null);
    setDraftBody("");
    setSaveState("idle");
  }

  function showNote(note: ReaderNote) {
    openExisting(note.id);
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          `[data-reader-note-id="${note.id}"]`,
        )
        ?.scrollIntoView({
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
          block: "center",
        });
    });
  }

  const editorOpen = Boolean(candidate || activeNote);
  const quote = activeNote?.quote || candidate?.quote || "";

  const toolbar = (
    <button
      type="button"
      className={panelOpen ? "notes-toggle active" : "notes-toggle"}
      onClick={() => setPanelOpen((value) => !value)}
      aria-expanded={panelOpen}
      aria-controls="reader-notes-panel"
      title="查看笔记"
    >
      <span>笔记</span>
      {notes.length ? <b>{notes.length}</b> : null}
    </button>
  );

  return (
    <>
      {toolbar}

      {candidate && !panelOpen
        ? createPortal(
            <button
              className="selection-note-action"
              type="button"
              style={{ top: candidate.top, left: candidate.left }}
              onPointerDown={(event) => event.preventDefault()}
              onClick={startDraft}
            >
              {candidate.overlappingNoteId ? "查看笔记" : "记笔记"}
            </button>,
            document.body,
          )
        : null}

      {panelOpen
        ? createPortal(
            <>
              <button
                className="notes-backdrop"
                type="button"
                aria-label="关闭笔记"
                onClick={() => setPanelOpen(false)}
              />
              <aside
                id="reader-notes-panel"
                className="notes-panel"
                aria-label="划词笔记"
              >
                <header className="notes-panel-head">
                  <div>
                    <strong>笔记</strong>
                    <span>{notes.length ? `${notes.length} 条` : "暂无"}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPanelOpen(false)}
                    aria-label="关闭笔记面板"
                  >
                    关闭
                  </button>
                </header>

                <div className="notes-panel-body">
                  {editorOpen ? (
                    <div className="note-editor">
                      <button
                        className="note-editor-back"
                        type="button"
                        onClick={closeEditor}
                      >
                        ← 全部笔记
                      </button>
                      <blockquote>{quote}</blockquote>
                      {activeNote &&
                      activeNote.versionId !== versionId ? (
                        <p className="note-version-hint">
                          这条笔记来自较早的译文版本。
                        </p>
                      ) : null}
                      <label>
                        <span>笔记内容</span>
                        <textarea
                          autoFocus
                          value={draftBody}
                          maxLength={6000}
                          readOnly={!viewer.isOwner}
                          placeholder={
                            viewer.isOwner
                              ? "写下你的理解、疑问或修改意见…"
                              : "这条笔记没有正文。"
                          }
                          onChange={(event) => changeBody(event.target.value)}
                          onKeyDown={(event) => {
                            if (
                              viewer.isOwner &&
                              (event.metaKey || event.ctrlKey) &&
                              event.key === "Enter"
                            ) {
                              event.preventDefault();
                              if (activeNote) void saveExisting();
                              else void createNote();
                            }
                          }}
                        />
                      </label>
                      {viewer.isOwner ? (
                        <div className="note-editor-tools">
                          <div className="note-colors" aria-label="高亮颜色">
                            {colors.map((item) => (
                              <button
                                type="button"
                                key={item.value}
                                className={
                                  draftColor === item.value ? "active" : ""
                                }
                                data-color={item.value}
                                onClick={() => changeColor(item.value)}
                                aria-label={item.label}
                                title={item.label}
                              />
                            ))}
                          </div>
                          <span className={`note-save-state ${saveState}`}>
                            {saveState === "saving"
                              ? "保存中…"
                              : saveState === "saved"
                                ? "已保存"
                                : saveState === "error"
                                  ? "保存失败"
                                  : dirty
                                    ? "尚未保存"
                                    : ""}
                          </span>
                        </div>
                      ) : null}
                      {viewer.isOwner ? (
                        <div className="note-editor-actions">
                          {activeNote ? (
                            <button
                              className={
                                deleteArmed ? "note-delete armed" : "note-delete"
                              }
                              type="button"
                              onClick={() => void deleteNote()}
                            >
                              {deleteArmed ? "再次点击删除" : "删除"}
                            </button>
                          ) : (
                            <span />
                          )}
                          <button
                            className="note-save"
                            type="button"
                            disabled={saveState === "saving"}
                            onClick={() =>
                              activeNote
                                ? void saveExisting()
                                : void createNote()
                            }
                          >
                            {activeNote ? "保存" : "新建笔记"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : loading ? (
                    <div className="notes-empty">正在载入笔记…</div>
                  ) : loadError ? (
                    <div className="notes-empty error">{loadError}</div>
                  ) : notes.length ? (
                    <div className="notes-list">
                      {notes.map((note) => (
                        <button
                          type="button"
                          key={note.id}
                          className="note-card"
                          data-color={note.color}
                          onClick={() => showNote(note)}
                        >
                          <span className="note-card-quote">{note.quote}</span>
                          <span className="note-card-body">
                            {note.body || "未填写笔记"}
                          </span>
                          {note.versionId !== versionId ? (
                            <small>较早版本</small>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="notes-empty">
                      <strong>还没有笔记</strong>
                      <p>
                        {viewer.isOwner
                          ? "在正文中选中文字，即可新建笔记。"
                          : "有笔记后会显示在这里。"}
                      </p>
                    </div>
                  )}
                </div>

                <footer className="notes-panel-foot">
                  {viewer.isOwner ? (
                    <>
                      <span>{viewer.displayName || "已登录"} · 可编辑</span>
                      <a href={viewer.signOutHref}>退出</a>
                    </>
                  ) : viewer.signedIn ? (
                    <>
                      <span>只读模式</span>
                      <a href={viewer.signOutHref}>退出</a>
                    </>
                  ) : (
                    <>
                      <span>浏览模式</span>
                      <a href={viewer.signInHref}>使用 ChatGPT 登录</a>
                    </>
                  )}
                </footer>
              </aside>
            </>,
            document.body,
          )
        : null}
    </>
  );
}

function noteRoot() {
  return document.querySelector<HTMLElement>("#reading-content .prose");
}

function captureSelection(
  root: HTMLElement,
  notes: ReaderNote[],
): SelectionCandidate | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  ) {
    return null;
  }

  const raw = range.toString();
  const firstContent = raw.search(/\S/);
  const lastContent = raw.search(/\s*$/);
  if (firstContent < 0) return null;
  const quote = raw.slice(firstContent, lastContent).trim();
  if (!quote || quote.length > 1000) return null;

  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const after = range.cloneRange();
  after.selectNodeContents(root);
  after.setEnd(range.endContainer, range.endOffset);
  const startOffset = before.toString().length + firstContent;
  const endOffset = after.toString().length - (raw.length - lastContent);
  if (endOffset <= startOffset) return null;

  const fullText = root.textContent || "";
  const resolvedNotes = notes
    .map((note) => ({ note, range: resolveNoteRange(note, fullText) }))
    .filter(
      (
        value,
      ): value is {
        note: ReaderNote;
        range: { start: number; end: number };
      } => Boolean(value.range),
    );
  const overlapping =
    resolvedNotes.find(
      ({ range: noteRange }) =>
        startOffset < noteRange.end && endOffset > noteRange.start,
    )?.note.id || "";

  const rect = range.getBoundingClientRect();
  const left = Math.min(
    window.innerWidth - 70,
    Math.max(70, rect.left + rect.width / 2),
  );
  const top =
    rect.bottom + 48 < window.innerHeight
      ? rect.bottom + 9
      : Math.max(10, rect.top - 45);

  return {
    quote,
    prefix: fullText.slice(Math.max(0, startOffset - 100), startOffset),
    suffix: fullText.slice(endOffset, endOffset + 100),
    startOffset,
    endOffset,
    top,
    left,
    overlappingNoteId: overlapping,
  };
}

function resolveNoteRange(note: ReaderNote, fullText: string) {
  if (
    note.startOffset >= 0 &&
    note.endOffset <= fullText.length &&
    fullText.slice(note.startOffset, note.endOffset) === note.quote
  ) {
    return { start: note.startOffset, end: note.endOffset };
  }

  const candidates: number[] = [];
  let cursor = fullText.indexOf(note.quote);
  while (cursor >= 0 && candidates.length < 50) {
    candidates.push(cursor);
    cursor = fullText.indexOf(note.quote, cursor + 1);
  }
  if (!candidates.length) return null;

  const best = candidates
    .map((start) => {
      const end = start + note.quote.length;
      let score = 0;
      if (note.prefix && fullText.slice(0, start).endsWith(note.prefix)) {
        score += 4;
      }
      if (note.suffix && fullText.slice(end).startsWith(note.suffix)) {
        score += 4;
      }
      score -= Math.abs(start - note.startOffset) / 100_000;
      return { start, end, score };
    })
    .sort((a, b) => b.score - a.score)[0];
  return { start: best.start, end: best.end };
}

function applyHighlights(root: HTMLElement, notes: ReaderNote[]) {
  root
    .querySelectorAll<HTMLElement>(".reader-note-highlight")
    .forEach((mark) =>
      mark.replaceWith(document.createTextNode(mark.textContent || "")),
    );
  root.normalize();

  const fullText = root.textContent || "";
  const positioned = notes
    .map((note) => ({ note, range: resolveNoteRange(note, fullText) }))
    .filter(
      (
        value,
      ): value is {
        note: ReaderNote;
        range: { start: number; end: number };
      } => Boolean(value.range),
    )
    .sort((a, b) => b.range.start - a.range.start);

  const accepted: Array<{ start: number; end: number }> = [];
  positioned.forEach(({ note, range }) => {
    if (
      accepted.some(
        (existing) =>
          range.start < existing.end && range.end > existing.start,
      )
    ) {
      return;
    }
    accepted.push(range);
    wrapTextRange(root, range.start, range.end, note);
  });
}

function wrapTextRange(
  root: HTMLElement,
  start: number,
  end: number,
  note: ReaderNote,
) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Array<{
    node: Text;
    start: number;
    end: number;
  }> = [];
  let offset = 0;
  let current = walker.nextNode();

  while (current) {
    const node = current as Text;
    const length = node.data.length;
    const nodeStart = offset;
    const nodeEnd = offset + length;
    if (start < nodeEnd && end > nodeStart) {
      targets.push({
        node,
        start: Math.max(0, start - nodeStart),
        end: Math.min(length, end - nodeStart),
      });
    }
    offset = nodeEnd;
    if (offset >= end) break;
    current = walker.nextNode();
  }

  targets.reverse().forEach((target) => {
    if (target.end <= target.start) return;
    const range = document.createRange();
    range.setStart(target.node, target.start);
    range.setEnd(target.node, target.end);
    const mark = document.createElement("mark");
    mark.className = "reader-note-highlight";
    mark.dataset.readerNoteId = note.id;
    mark.dataset.noteColor = note.color;
    mark.tabIndex = 0;
    mark.title = "查看笔记";
    range.surroundContents(mark);
  });
}
