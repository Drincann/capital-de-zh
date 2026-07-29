import { getD1 } from "@/db";
import { getNotesEditor } from "@/lib/notes-auth";

const colors = new Set(["amber", "rose", "sage", "blue"]);
const sectionPattern = /^[a-z0-9][a-z0-9-]{0,79}$/i;

type StoredNote = {
  id: string;
  section_id: string;
  version_id: string;
  quote: string;
  prefix: string;
  suffix: string;
  start_offset: number;
  end_offset: number;
  body: string;
  color: string;
  created_at: string;
  updated_at: string;
};

type NoteInput = {
  id?: unknown;
  sectionId?: unknown;
  versionId?: unknown;
  quote?: unknown;
  prefix?: unknown;
  suffix?: unknown;
  startOffset?: unknown;
  endOffset?: unknown;
  body?: unknown;
  color?: unknown;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sectionId = url.searchParams.get("sectionId") || "";
  if (!sectionPattern.test(sectionId)) {
    return json({ error: "无效的章节标识。" }, 400);
  }

  try {
    const result = await getD1()
      .prepare(
        `SELECT id, section_id, version_id, quote, prefix, suffix,
          start_offset, end_offset, body, color, created_at, updated_at
         FROM reader_notes
         WHERE section_id = ?
         ORDER BY start_offset ASC, created_at ASC`,
      )
      .bind(sectionId)
      .all<StoredNote>();

    return json({ notes: (result.results || []).map(publicNote) });
  } catch {
    return storageError();
  }
}

export async function POST(request: Request) {
  const editor = await getNotesEditor();
  if (!editor.user) return authorizationError(editor.status);

  const input = await readInput(request);
  if (!input) return json({ error: "笔记内容无效。" }, 400);

  const sectionId = requiredText(input.sectionId, 80);
  const versionId = requiredText(input.versionId, 100);
  const quote = requiredText(input.quote, 1000);
  const prefix = optionalText(input.prefix, 180);
  const suffix = optionalText(input.suffix, 180);
  const body = optionalText(input.body, 6000);
  const color = requiredText(input.color, 12);
  const startOffset = integer(input.startOffset);
  const endOffset = integer(input.endOffset);

  if (
    sectionId === null ||
    versionId === null ||
    quote === null ||
    prefix === null ||
    suffix === null ||
    body === null ||
    color === null ||
    !sectionPattern.test(sectionId) ||
    !colors.has(color) ||
    startOffset < 0 ||
    endOffset <= startOffset ||
    endOffset > 2_000_000
  ) {
    return json({ error: "笔记内容无效。" }, 400);
  }

  const id = crypto.randomUUID();
  const ownerEmail = editor.user.email.toLowerCase();
  try {
    await getD1()
      .prepare(
        `INSERT INTO reader_notes (
          id, section_id, version_id, owner_email, quote, prefix, suffix,
          start_offset, end_offset, body, color, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .bind(
        id,
        sectionId,
        versionId,
        ownerEmail,
        quote,
        prefix,
        suffix,
        startOffset,
        endOffset,
        body,
        color,
      )
      .run();

    const note = await findNote(id);
    return json({ note: note ? publicNote(note) : null }, 201);
  } catch {
    return storageError();
  }
}

export async function PATCH(request: Request) {
  const editor = await getNotesEditor();
  if (!editor.user) return authorizationError(editor.status);

  const input = await readInput(request);
  if (!input) return json({ error: "笔记内容无效。" }, 400);

  const id = requiredText(input.id, 80);
  const body = optionalText(input.body, 6000);
  const color = requiredText(input.color, 12);
  if (id === null || body === null || color === null || !colors.has(color)) {
    return json({ error: "笔记内容无效。" }, 400);
  }

  try {
    const result = await getD1()
      .prepare(
        `UPDATE reader_notes
         SET body = ?, color = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND owner_email = ?`,
      )
      .bind(body, color, id, editor.user.email.toLowerCase())
      .run();

    if (!result.meta.changes) {
      return json({ error: "没有找到这条笔记。" }, 404);
    }
    const note = await findNote(id);
    return json({ note: note ? publicNote(note) : null });
  } catch {
    return storageError();
  }
}

export async function DELETE(request: Request) {
  const editor = await getNotesEditor();
  if (!editor.user) return authorizationError(editor.status);

  const input = await readInput(request);
  const id = input ? requiredText(input.id, 80) : null;
  if (id === null) return json({ error: "笔记内容无效。" }, 400);

  try {
    const result = await getD1()
      .prepare("DELETE FROM reader_notes WHERE id = ? AND owner_email = ?")
      .bind(id, editor.user.email.toLowerCase())
      .run();

    if (!result.meta.changes) {
      return json({ error: "没有找到这条笔记。" }, 404);
    }
    return json({ ok: true });
  } catch {
    return storageError();
  }
}

async function findNote(id: string) {
  return getD1()
    .prepare(
      `SELECT id, section_id, version_id, quote, prefix, suffix,
        start_offset, end_offset, body, color, created_at, updated_at
       FROM reader_notes WHERE id = ?`,
    )
    .bind(id)
    .first<StoredNote>();
}

function publicNote(note: StoredNote) {
  return {
    id: note.id,
    sectionId: note.section_id,
    versionId: note.version_id,
    quote: note.quote,
    prefix: note.prefix,
    suffix: note.suffix,
    startOffset: note.start_offset,
    endOffset: note.end_offset,
    body: note.body,
    color: note.color,
    createdAt: note.created_at,
    updatedAt: note.updated_at,
  };
}

async function readInput(request: Request): Promise<NoteInput | null> {
  try {
    const value = (await request.json()) as unknown;
    return value && typeof value === "object" ? (value as NoteInput) : null;
  } catch {
    return null;
  }
}

function requiredText(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\u0000/g, "").trim();
  if (!normalized || normalized.length > max) return null;
  return normalized;
}

function optionalText(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\u0000/g, "").trim();
  return normalized.length <= max ? normalized : null;
}

function integer(value: unknown) {
  return Number.isSafeInteger(value) ? Number(value) : -1;
}

function authorizationError(status: 401 | 403) {
  return json(
    {
      error:
        status === 401
          ? "请先使用 ChatGPT 登录。"
          : "当前账号没有编辑权限。",
    },
    status,
  );
}

function storageError() {
  return json({ error: "笔记服务暂时不可用，请稍后重试。" }, 503);
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
