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
const panelWidthKey = "capital-reader-notes-width";
const editorHeightKey = "capital-reader-note-editor-height";
const defaultPanelWidth = 400;
const defaultEditorHeight = 220;

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
    const storedPanelWidth = Number(localStorage.getItem(panelWidthKey));
    const storedEditorHeight = Number(localStorage.getItem(editorHeightKey));
    if (Number.isFinite(storedPanelWidth) && storedPanelWidth > 0) {
      applyPanelWidth(storedPanelWidth);
    }
    if (Number.isFinite(storedEditorHeight) && storedEditorHeight > 0) {
      applyEditorHeight(storedEditorHeight);
    }
  }, []);

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
    let selectionStartedInRoot = false;

    function captureSoon() {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const next = captureSelection(root!, notes);
        setCandidate(next);
      }, 40);
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      selectionStartedInRoot = Boolean(target && root!.contains(target));
      if (
        target?.closest(
          ".selection-note-action, .notes-panel, [data-reader-note-id]",
        )
      ) {
        return;
      }
      if (!root!.contains(target)) setCandidate(null);
    }

    function handlePointerUp() {
      if (selectionStartedInRoot) captureSoon();
      selectionStartedInRoot = false;
    }

    function handlePointerCancel() {
      selectionStartedInRoot = false;
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerCancel);
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

  function beginPanelResize(event: React.PointerEvent<HTMLElement>) {
    if (matchMedia("(max-width: 900px)").matches) return;
    event.preventDefault();
    const panel = event.currentTarget.closest<HTMLElement>(".notes-panel");
    if (!panel) return;
    const startX = event.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    document.body.classList.add("notes-resizing");

    function move(moveEvent: PointerEvent) {
      applyPanelWidth(startWidth + startX - moveEvent.clientX);
    }

    function finish() {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      document.body.classList.remove("notes-resizing");
      localStorage.setItem(
        panelWidthKey,
        String(currentCssPixels("--notes-panel-width", defaultPanelWidth)),
      );
    }

    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
  }

  function changePanelWidthBy(delta: number) {
    applyPanelWidth(
      currentCssPixels("--notes-panel-width", defaultPanelWidth) + delta,
    );
    localStorage.setItem(
      panelWidthKey,
      String(currentCssPixels("--notes-panel-width", defaultPanelWidth)),
    );
  }

  function resetPanelWidth() {
    applyPanelWidth(defaultPanelWidth);
    localStorage.setItem(panelWidthKey, String(defaultPanelWidth));
  }

  function beginEditorResize(event: React.PointerEvent<HTMLElement>) {
    event.preventDefault();
    const shell = event.currentTarget.closest<HTMLElement>(
      ".note-textarea-shell",
    );
    if (!shell) return;
    const startY = event.clientY;
    const startHeight = shell.getBoundingClientRect().height;
    document.body.classList.add("note-editor-resizing");

    function move(moveEvent: PointerEvent) {
      applyEditorHeight(startHeight + moveEvent.clientY - startY);
    }

    function finish() {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      document.body.classList.remove("note-editor-resizing");
      localStorage.setItem(
        editorHeightKey,
        String(
          currentCssPixels("--note-editor-height", defaultEditorHeight),
        ),
      );
    }

    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
  }

  function changeEditorHeightBy(delta: number) {
    applyEditorHeight(
      currentCssPixels("--note-editor-height", defaultEditorHeight) + delta,
    );
    localStorage.setItem(
      editorHeightKey,
      String(currentCssPixels("--note-editor-height", defaultEditorHeight)),
    );
  }

  function resetEditorHeight() {
    applyEditorHeight(defaultEditorHeight);
    localStorage.setItem(editorHeightKey, String(defaultEditorHeight));
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
      aria-label="笔记"
      title="笔记"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4" />
        <path d="M2 6h4M2 10h4M2 14h4M2 18h4" />
        <path d="M21.38 5.63a1 1 0 0 0-3.01-3.01l-5.01 5.01a2 2 0 0 0-.5.86l-.84 2.87a.5.5 0 0 0 .62.62l2.87-.84a2 2 0 0 0 .86-.5Z" />
      </svg>
      {notes.length ? <b>{notes.length > 99 ? "99+" : notes.length}</b> : null}
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
                <div
                  className="notes-panel-resizer"
                  role="separator"
                  tabIndex={0}
                  aria-label="调整笔记栏宽度"
                  aria-orientation="vertical"
                  onPointerDown={beginPanelResize}
                  onDoubleClick={resetPanelWidth}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft") {
                      event.preventDefault();
                      changePanelWidthBy(16);
                    } else if (event.key === "ArrowRight") {
                      event.preventDefault();
                      changePanelWidthBy(-16);
                    } else if (event.key === "Home") {
                      event.preventDefault();
                      resetPanelWidth();
                    }
                  }}
                />
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
                        aria-label="返回全部笔记"
                        title="返回全部笔记"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <path d="M19 12H5M11 6l-6 6 6 6" />
                        </svg>
                      </button>
                      <blockquote>{quote}</blockquote>
                      {activeNote &&
                      activeNote.versionId !== versionId ? (
                        <p className="note-version-hint">
                          这条笔记来自较早的译文版本。
                        </p>
                      ) : null}
                      <label>
                        <div
                          className={
                            viewer.isOwner
                              ? "note-textarea-shell"
                              : "note-textarea-shell readonly"
                          }
                        >
                          <textarea
                            autoFocus
                            aria-label="笔记内容"
                            value={draftBody}
                            maxLength={6000}
                            readOnly={!viewer.isOwner}
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
                          {viewer.isOwner ? (
                            <div
                              className="note-textarea-resizer"
                              role="separator"
                              tabIndex={0}
                              aria-label="调整笔记编辑框高度"
                              aria-orientation="horizontal"
                              onPointerDown={beginEditorResize}
                              onDoubleClick={resetEditorHeight}
                              onKeyDown={(event) => {
                                if (event.key === "ArrowUp") {
                                  event.preventDefault();
                                  changeEditorHeightBy(-16);
                                } else if (event.key === "ArrowDown") {
                                  event.preventDefault();
                                  changeEditorHeightBy(16);
                                } else if (event.key === "Home") {
                                  event.preventDefault();
                                  resetEditorHeight();
                                }
                              }}
                            />
                          ) : null}
                        </div>
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

function applyPanelWidth(value: number) {
  const max = Math.max(
    320,
    Math.min(640, Math.round(window.innerWidth * 0.62)),
  );
  const width = Math.min(max, Math.max(320, Math.round(value)));
  document.documentElement.style.setProperty(
    "--notes-panel-width",
    `${width}px`,
  );
}

function applyEditorHeight(value: number) {
  const max = Math.max(
    defaultEditorHeight,
    Math.min(600, window.innerHeight - 190),
  );
  const height = Math.min(max, Math.max(150, Math.round(value)));
  document.documentElement.style.setProperty(
    "--note-editor-height",
    `${height}px`,
  );
}

function currentCssPixels(name: string, fallback: number) {
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(name),
  );
  return Number.isFinite(value) ? value : fallback;
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
  const selectedRange = selection.getRangeAt(0);
  if (!selectedRange.intersectsNode(root)) {
    return null;
  }
  const range = selectedRange.cloneRange();
  if (!root.contains(range.startContainer)) {
    range.setStart(root, 0);
  }
  if (!root.contains(range.endContainer)) {
    range.setEnd(root, root.childNodes.length);
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
