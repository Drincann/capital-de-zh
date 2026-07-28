#!/usr/bin/env python3
"""Durable controller for the plain-Chinese Capital reader's edition."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


STANDARD_VERSION = "reader-edition-v3"
SPEC_FILES = (
    "reader-edition-standard.md",
    "workflow.md",
    "release-policy.md",
)
TASK_STATES = (
    "pending",
    "in_progress",
    "drafted",
    "meaning_reviewed",
    "readability_reviewed",
    "approved",
    "superseded",
)
SOURCE_STATES = {
    "candidate",
    "downloaded-unverified",
    "search-aid-only",
    "edition-verified",
    "passage-verified",
    "rejected",
}
CHAPTER_STATES = (
    "source_locked",
    "chunked",
    "drafted",
    "meaning_reviewed",
    "readability_reviewed",
    "assembled",
    "user_approved",
    "released",
)
CHAPTER_TITLES = {
    "ch01": "第一章 商品",
    "ch02": "第二章 交换过程",
    "ch03": "第三章 货币或商品流通",
    "ch04": "第四章 货币转化为资本",
    "ch05": "第五章 劳动过程和价值增殖过程",
    "ch06": "第六章 不变资本和可变资本",
    "ch07": "第七章 剩余价值率",
    "ch08": "第八章 工作日",
    "ch09": "第九章 剩余价值率和剩余价值量",
}
PARAGRAPH_HEADER = re.compile(
    r"^\[(?P<id>v1-[^\]]+-p\d+[a-z]?)\](?P<locator>[^\n]*)$", re.MULTILINE
)
INTERNAL_MARKERS = re.compile(
    r"\bv1-ch\d+|task[_ -]?id|source_sha256|spec_sha256|"
    r"meaning[_ -]?review|readability[_ -]?review",
    re.IGNORECASE,
)


WORKFLOW_TEXT = """# Workflow

This project is controlled by files, not chat memory.

## Chapter pipeline

`source_locked -> chunked -> drafted -> meaning_reviewed ->
readability_reviewed -> assembled -> user_approved -> released`

## Task pipeline

`pending -> in_progress -> drafted -> meaning_reviewed ->
readability_reviewed -> approved`

1. Run `validate` and `context` whenever work resumes.
2. Open only the next pending task package and the active specification.
3. Write reader-facing Chinese only to the task's draft artifact.
4. Save meaning and readability reviews as separate Markdown files.
5. Update task status only after its required file exists.
6. Assemble a chapter only from approved tasks with unchanged hashes.
7. Never overwrite an approved release silently. Create a new task revision and
   append a progress event and decision.
"""


RELEASE_TEXT = """# Release policy

The public edition consists only of UTF-8 Markdown files under `reader-edition/`,
one file per chapter.

A chapter may be released only when:

- every source paragraph is covered once, with no gap or overlap;
- every task is approved after meaning and source-blind readability review;
- every recorded artifact hash still matches;
- the assembled Markdown contains no internal IDs, task metadata, or review text;
- the user has approved the chapter or the governing sample style.

Inline translator notes use `〔译者注：……〕`. They are sparse, short, and only
prevent misunderstanding, add indispensable context, or mark interpretation.
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def relative(root: Path, path: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def atomic_write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(value, encoding="utf-8", newline="\n")
    temporary.replace(path)


def write_json(path: Path, value: Any) -> None:
    atomic_write_text(
        path, json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    )


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{path}:{number}: invalid JSON: {exc}") from exc
        if not isinstance(value, dict):
            raise ValueError(f"{path}:{number}: JSONL row is not an object")
        rows.append(value)
    return rows


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    text = "".join(
        json.dumps(row, ensure_ascii=False, sort_keys=False) + "\n" for row in rows
    )
    atomic_write_text(path, text)


def append_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def load_project(root: Path) -> dict[str, Any]:
    path = root / "project.json"
    if not path.is_file():
        raise SystemExit(f"Missing project.json: {path}")
    value = read_json(path)
    if not isinstance(value, dict):
        raise SystemExit("project.json must contain an object")
    return value


def skill_root() -> Path:
    return Path(__file__).resolve().parents[1]


def spec_hash(root: Path) -> str:
    digest = hashlib.sha256()
    for name in SPEC_FILES:
        path = root / "spec" / name
        if not path.is_file():
            raise SystemExit(f"Missing active specification: {path}")
        digest.update(name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def tree_hash(path: Path) -> str:
    digest = hashlib.sha256()
    files = sorted(
        item
        for item in path.rglob("*")
        if item.is_file() and "__pycache__" not in item.parts
    )
    for item in files:
        digest.update(item.relative_to(path).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(item.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def parse_source(path: Path) -> list[dict[str, str]]:
    text = path.read_text(encoding="utf-8")
    text = text.split("\n## Footnotes", 1)[0]
    matches = list(PARAGRAPH_HEADER.finditer(text))
    if not matches:
        raise SystemExit(f"No stable paragraph IDs found in {path}")
    paragraphs: list[dict[str, str]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        block = text[match.start() : end].strip()
        if block.startswith("## Footnotes"):
            break
        paragraphs.append(
            {
                "id": match.group("id"),
                "locator": match.group("locator").strip(),
                "block": block,
            }
        )
    return paragraphs


def paragraph_number(paragraph_id: str) -> int:
    match = re.search(r"-p(\d+)", paragraph_id)
    if not match:
        raise ValueError(f"Invalid paragraph ID: {paragraph_id}")
    return int(match.group(1))


def ensure_project_dirs(root: Path) -> None:
    for path in (
        root / "spec",
        root / "sources" / "raw",
        root / "sources" / "facsimiles",
        root / "sources" / "normalized",
        root / "chapters",
        root / "reader-edition",
        root / "decisions",
        root / "manifests",
        root / "progress",
        root / "skill-snapshot",
    ):
        path.mkdir(parents=True, exist_ok=True)
    for path in (
        root / "manifests" / "chapters.jsonl",
        root / "manifests" / "tasks.jsonl",
        root / "manifests" / "releases.jsonl",
        root / "decisions" / "translation-decisions.jsonl",
        root / "progress" / "events.jsonl",
    ):
        if not path.exists():
            atomic_write_text(path, "")


def install_spec(root: Path) -> None:
    standard_source = skill_root() / "references" / "translation-standard.md"
    targets = {
        "reader-edition-standard.md": standard_source.read_text(encoding="utf-8"),
        "workflow.md": WORKFLOW_TEXT,
        "release-policy.md": RELEASE_TEXT,
    }
    for name, content in targets.items():
        path = root / "spec" / name
        if not path.exists():
            atomic_write_text(path, content.rstrip() + "\n")


def install_skill_snapshot(root: Path) -> str:
    destination = root / "skill-snapshot" / STANDARD_VERSION
    if not destination.exists():
        shutil.copytree(
            skill_root(),
            destination,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )
    return relative(root, destination)


def add_or_refresh_chapter_rows(root: Path) -> list[dict[str, Any]]:
    manifest_path = root / "manifests" / "chapters.jsonl"
    existing = {
        row.get("chapter_id"): row for row in read_jsonl(manifest_path)
    }
    for chapter_dir in sorted((root / "chapters").glob("ch[0-9][0-9]")):
        chapter_id = chapter_dir.name
        source_path = chapter_dir / "source" / "de-1890.txt"
        if not source_path.is_file():
            continue
        for directory in ("tasks", "drafts", "reviews"):
            (chapter_dir / directory).mkdir(parents=True, exist_ok=True)
        for file_name in ("alignment.jsonl", "variants.jsonl", "decisions.jsonl"):
            target = chapter_dir / file_name
            if not target.exists():
                atomic_write_text(target, "")
        title = CHAPTER_TITLES.get(chapter_id, chapter_id)
        output_name = f"{title}.md"
        row = existing.get(chapter_id, {})
        row.update(
            {
                "chapter_id": chapter_id,
                "title_zh": row.get("title_zh") or title,
                "source_path": relative(root, source_path),
                "source_sha256": sha256_file(source_path),
                "status": row.get("status") or "source_locked",
                "output_path": row.get("output_path")
                or f"reader-edition/{output_name}",
                "last_updated": now(),
            }
        )
        status_path = chapter_dir / "status.json"
        write_json(
            status_path,
            {
                "chapter_id": chapter_id,
                "status": row["status"],
                "last_updated": row["last_updated"],
            },
        )
        existing[chapter_id] = row
    rows = [existing[key] for key in sorted(existing)]
    write_jsonl(manifest_path, rows)
    return rows


def append_event(
    root: Path,
    *,
    chapter: str = "",
    task_id: str = "",
    stage: str,
    artifact: str,
    result: str,
    next_stage: str,
) -> None:
    append_jsonl(
        root / "progress" / "events.jsonl",
        {
            "time": now(),
            "chapter": chapter,
            "task_id": task_id,
            "stage": stage,
            "artifact": artifact,
            "result": result,
            "next": next_stage,
        },
    )


def migrate(root: Path) -> None:
    project = load_project(root)
    ensure_project_dirs(root)
    install_spec(root)
    snapshot_path = install_skill_snapshot(root)
    chapters = add_or_refresh_chapter_rows(root)
    project.update(
        {
            "project_type": "plain-language-reader-edition",
            "target_reader": "高中或本科教育程度、无经济学或哲学专业背景的普通读者",
            "final_format": "markdown-one-file-per-chapter",
            "translation_policy": (
                "读者理解优先；允许改写句法、重组段落和删减非核心修辞，"
                "不得改变核心命题、逻辑关系和关键概念区别"
            ),
            "inline_note_syntax": "〔译者注：……〕",
            "standard_version": STANDARD_VERSION,
            "skill_snapshot": snapshot_path,
            "spec_sha256": spec_hash(root),
            "status": "reader-edition-spec-locked",
            "last_updated": now(),
        }
    )
    write_json(root / "project.json", project)
    project_md = f"""# {project.get('title', '《资本论》现代汉语读者版')}

本项目从可靠的德文文本出发，制作一套面向普通读者的现代汉语通俗新译。
目标读者不需要预先学过经济学、哲学或马克思主义术语。

最终公开成果位于 `reader-edition/`，每章一个 Markdown 文件。原文、版本
核对、任务包、草稿、校对和决策记录全部留在后台，不进入读者正文。

翻译允许重写句法、拆分或合并句子、显化省略的推理、压缩不影响论证的
重复和次要修辞。它不得改变核心命题、因果或条件关系、关键概念区别、
事实、数字和引文。

任何新任务或上下文压缩后，先运行：

```powershell
python skill-snapshot/{STANDARD_VERSION}/scripts/reader_project_controller.py validate .
python skill-snapshot/{STANDARD_VERSION}/scripts/reader_project_controller.py context .
```

当前阶段：读者版规范已锁定；已登记 {len(chapters)} 章的来源。
"""
    atomic_write_text(root / "PROJECT.md", project_md)
    append_event(
        root,
        stage="reader-edition-migration",
        artifact="project.json;spec/;manifests/",
        result="completed",
        next_stage="make-pilot-tasks",
    )
    print(
        json.dumps(
            {
                "project": project["project_id"],
                "standard_version": STANDARD_VERSION,
                "spec_sha256": project["spec_sha256"],
                "chapters": [row["chapter_id"] for row in chapters],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def task_package_text(
    *,
    row: dict[str, Any],
    chapter: dict[str, Any],
    source_blocks: str,
    terminology: str,
) -> str:
    return f"""# Reader-edition translation task {row['task_id']}

## Immutable task metadata

- Chapter: `{chapter['chapter_id']}` — {chapter['title_zh']}
- Paragraphs: `{row['start_paragraph']}` through `{row['end_paragraph']}`
- Source slice SHA-256: `{row['source_sha256']}`
- Active specification SHA-256: `{row['spec_sha256']}`
- Draft output: `{row['artifact_path']}`

## Reader contract

Write for a reader with high-school or undergraduate education and no specialist
background. Produce direct, natural, present-day Chinese. The reader should be
able to paraphrase each paragraph after one reading.

You may split, merge, reorder, name implicit subjects, unpack an entailed
reasoning step, shorten redundant repetition, and replace opaque imagery with its
direct meaning. Preserve the core claim, logical relations, indispensable
conceptual distinctions, facts, numbers, and quoted positions.

Use `〔译者注：……〕` only to prevent a likely misunderstanding, add essential
historical context, or mark a real interpretive choice. Keep notes short and
sparse.

Write only the reader-facing Chinese body to the draft output. Do not include
German, paragraph IDs, task metadata, QA notes, or a separate guide.

## Active terminology and decisions

```text
{terminology.strip() or '(none recorded)'}
```

## Exact German source

```text
{source_blocks}
```

## Acceptance gates

1. Meaning audit against the exact German source.
2. Source-blind one-read comprehension audit.
3. Translator-note necessity audit.
4. Save each review under `chapters/{chapter['chapter_id']}/reviews/`.
5. Update durable task status only after its artifact exists.
"""


def make_tasks(
    root: Path,
    chapter_id: str,
    max_paragraphs: int,
    title: str | None = None,
) -> None:
    load_project(root)
    if max_paragraphs < 1 or max_paragraphs > 20:
        raise SystemExit("--max-paragraphs must be between 1 and 20")
    chapter_rows = read_jsonl(root / "manifests" / "chapters.jsonl")
    chapter = next(
        (row for row in chapter_rows if row.get("chapter_id") == chapter_id), None
    )
    if chapter is None:
        source = root / "chapters" / chapter_id / "source" / "de-1890.txt"
        if not source.is_file():
            raise SystemExit(f"No registered chapter or base source for {chapter_id}")
        add_or_refresh_chapter_rows(root)
        chapter_rows = read_jsonl(root / "manifests" / "chapters.jsonl")
        chapter = next(
            row for row in chapter_rows if row.get("chapter_id") == chapter_id
        )
    if title:
        chapter["title_zh"] = title
        chapter["output_path"] = f"reader-edition/{title}.md"

    all_tasks = read_jsonl(root / "manifests" / "tasks.jsonl")
    active = [
        row
        for row in all_tasks
        if row.get("chapter_id") == chapter_id
        and row.get("status") != "superseded"
    ]
    if active:
        raise SystemExit(
            f"{chapter_id} already has {len(active)} active tasks; "
            "supersede or finish them before rechunking"
        )

    source_path = root / str(chapter["source_path"])
    paragraphs = parse_source(source_path)
    current_spec_hash = spec_hash(root)
    terminology_path = root / "decisions" / "terminology.tsv"
    terminology = (
        terminology_path.read_text(encoding="utf-8")
        if terminology_path.is_file()
        else ""
    )
    created: list[dict[str, Any]] = []
    for index in range(0, len(paragraphs), max_paragraphs):
        group = paragraphs[index : index + max_paragraphs]
        source_blocks = "\n\n".join(item["block"] for item in group)
        first_num = paragraph_number(group[0]["id"])
        last_num = paragraph_number(group[-1]["id"])
        task_id = f"{chapter_id}-p{first_num:04d}-p{last_num:04d}-r1"
        task_package = (
            root / "chapters" / chapter_id / "tasks" / f"{task_id}.md"
        )
        artifact = (
            root / "chapters" / chapter_id / "drafts" / f"{task_id}.md"
        )
        row = {
            "task_id": task_id,
            "chapter_id": chapter_id,
            "start_paragraph": group[0]["id"],
            "end_paragraph": group[-1]["id"],
            "task_package_path": relative(root, task_package),
            "base_source_path": str(chapter["source_path"]),
            "source_sha256": sha256_text(source_blocks),
            "spec_sha256": current_spec_hash,
            "status": "pending",
            "artifact_path": relative(root, artifact),
            "artifact_sha256": "",
            "meaning_review_path": "",
            "readability_review_path": "",
            "dependencies": [],
            "revision": 1,
            "last_updated": now(),
        }
        atomic_write_text(
            task_package,
            task_package_text(
                row=row,
                chapter=chapter,
                source_blocks=source_blocks,
                terminology=terminology,
            ),
        )
        created.append(row)
    all_tasks.extend(created)
    write_jsonl(root / "manifests" / "tasks.jsonl", all_tasks)
    chapter["status"] = "chunked"
    chapter["last_updated"] = now()
    write_jsonl(root / "manifests" / "chapters.jsonl", chapter_rows)
    write_json(
        root / "chapters" / chapter_id / "status.json",
        {
            "chapter_id": chapter_id,
            "status": "chunked",
            "task_count": len(created),
            "last_updated": chapter["last_updated"],
        },
    )
    append_event(
        root,
        chapter=chapter_id,
        stage="task-chunking",
        artifact=f"chapters/{chapter_id}/tasks",
        result=f"completed:{len(created)}",
        next_stage="draft",
    )
    print(
        json.dumps(
            {
                "chapter": chapter_id,
                "paragraphs": len(paragraphs),
                "tasks_created": len(created),
                "task_ids": [row["task_id"] for row in created],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def task_update(
    root: Path,
    task_id: str,
    new_status: str,
    artifact_path: str | None,
    review_path: str | None,
) -> None:
    if new_status not in TASK_STATES:
        raise SystemExit(f"Invalid task status: {new_status}")
    path = root / "manifests" / "tasks.jsonl"
    rows = read_jsonl(path)
    row = next((item for item in rows if item.get("task_id") == task_id), None)
    if row is None:
        raise SystemExit(f"Unknown task: {task_id}")
    old_status = str(row["status"])
    if old_status == "superseded":
        raise SystemExit("A superseded task cannot be updated")
    if new_status != "superseded":
        expected = TASK_STATES.index(old_status) + 1
        if expected >= TASK_STATES.index("superseded"):
            raise SystemExit(f"Task is already terminal: {old_status}")
        if TASK_STATES[expected] != new_status:
            raise SystemExit(
                f"Invalid transition {old_status} -> {new_status}; "
                f"expected {TASK_STATES[expected]}"
            )
    if artifact_path:
        row["artifact_path"] = artifact_path.replace("\\", "/")
    artifact = root / str(row["artifact_path"])
    if TASK_STATES.index(new_status) >= TASK_STATES.index("drafted"):
        if not artifact.is_file():
            raise SystemExit(f"Draft artifact does not exist: {artifact}")
        row["artifact_sha256"] = sha256_file(artifact)
    if new_status == "meaning_reviewed":
        if not review_path:
            raise SystemExit("--review-path is required for meaning_reviewed")
        review = root / review_path
        if not review.is_file():
            raise SystemExit(f"Meaning review does not exist: {review}")
        row["meaning_review_path"] = review_path.replace("\\", "/")
    if new_status == "readability_reviewed":
        if not review_path:
            raise SystemExit("--review-path is required for readability_reviewed")
        review = root / review_path
        if not review.is_file():
            raise SystemExit(f"Readability review does not exist: {review}")
        row["readability_review_path"] = review_path.replace("\\", "/")
    if new_status == "approved":
        if not row.get("meaning_review_path") or not row.get(
            "readability_review_path"
        ):
            raise SystemExit("Both review paths are required before approval")
    row["status"] = new_status
    row["last_updated"] = now()
    write_jsonl(path, rows)
    append_event(
        root,
        chapter=str(row["chapter_id"]),
        task_id=task_id,
        stage=new_status,
        artifact=str(row.get("artifact_path", "")),
        result="completed",
        next_stage=(
            TASK_STATES[TASK_STATES.index(new_status) + 1]
            if new_status not in ("approved", "superseded")
            else ""
        ),
    )
    print(f"{task_id}: {old_status} -> {new_status}")


def chapter_advance(root: Path, chapter_id: str, new_status: str) -> None:
    if new_status not in CHAPTER_STATES:
        raise SystemExit(f"Invalid chapter status: {new_status}")
    path = root / "manifests" / "chapters.jsonl"
    rows = read_jsonl(path)
    chapter = next(
        (row for row in rows if row.get("chapter_id") == chapter_id), None
    )
    if chapter is None:
        raise SystemExit(f"Unknown chapter: {chapter_id}")
    old_status = str(chapter["status"])
    expected_index = CHAPTER_STATES.index(old_status) + 1
    if expected_index >= len(CHAPTER_STATES) or CHAPTER_STATES[expected_index] != new_status:
        expected = (
            CHAPTER_STATES[expected_index]
            if expected_index < len(CHAPTER_STATES)
            else "none"
        )
        raise SystemExit(
            f"Invalid transition {old_status} -> {new_status}; expected {expected}"
        )
    tasks = [
        row
        for row in read_jsonl(root / "manifests" / "tasks.jsonl")
        if row.get("chapter_id") == chapter_id
        and row.get("status") != "superseded"
    ]
    minimum_task_status = {
        "chunked": "pending",
        "drafted": "drafted",
        "meaning_reviewed": "meaning_reviewed",
        "readability_reviewed": "readability_reviewed",
    }.get(new_status)
    if minimum_task_status:
        if not tasks:
            raise SystemExit(f"{chapter_id} has no active tasks")
        minimum_index = TASK_STATES.index(minimum_task_status)
        failed = [
            row["task_id"]
            for row in tasks
            if TASK_STATES.index(str(row["status"])) < minimum_index
        ]
        if failed:
            raise SystemExit(
                f"Tasks below {minimum_task_status}: {', '.join(failed)}"
            )
    output = root / str(chapter["output_path"])
    if new_status in ("assembled", "user_approved", "released") and not output.is_file():
        raise SystemExit(f"Chapter output does not exist: {output}")
    chapter["status"] = new_status
    chapter["last_updated"] = now()
    write_jsonl(path, rows)
    write_json(
        root / "chapters" / chapter_id / "status.json",
        {
            "chapter_id": chapter_id,
            "status": new_status,
            "last_updated": chapter["last_updated"],
        },
    )
    if new_status == "released":
        append_jsonl(
            root / "manifests" / "releases.jsonl",
            {
                "chapter_id": chapter_id,
                "output_path": str(chapter["output_path"]),
                "sha256": sha256_file(output),
                "released_at": now(),
            },
        )
    append_event(
        root,
        chapter=chapter_id,
        stage=new_status,
        artifact=str(chapter.get("output_path", "")),
        result="completed",
        next_stage=(
            CHAPTER_STATES[CHAPTER_STATES.index(new_status) + 1]
            if new_status != "released"
            else ""
        ),
    )
    print(f"{chapter_id}: {old_status} -> {new_status}")


def assemble(root: Path, chapter_id: str) -> None:
    chapters = read_jsonl(root / "manifests" / "chapters.jsonl")
    chapter = next(
        (row for row in chapters if row.get("chapter_id") == chapter_id), None
    )
    if chapter is None:
        raise SystemExit(f"Unknown chapter: {chapter_id}")
    tasks = sorted(
        (
            row
            for row in read_jsonl(root / "manifests" / "tasks.jsonl")
            if row.get("chapter_id") == chapter_id
            and row.get("status") != "superseded"
        ),
        key=lambda row: paragraph_number(str(row["start_paragraph"])),
    )
    if not tasks or any(row.get("status") != "approved" for row in tasks):
        raise SystemExit("Assembly requires every active task to be approved")
    old_status = str(chapter["status"])
    if old_status != "readability_reviewed":
        raise SystemExit(
            "Chapter must be readability_reviewed before assembly; "
            f"current status is {old_status}"
        )
    source_paragraphs = parse_source(root / str(chapter["source_path"]))
    expected = [item["id"] for item in source_paragraphs]
    coverage: list[str] = []
    for row in tasks:
        start = expected.index(str(row["start_paragraph"]))
        end = expected.index(str(row["end_paragraph"]))
        coverage.extend(expected[start : end + 1])
    if coverage != expected:
        raise SystemExit("Task ranges do not cover source paragraphs exactly once")
    bodies: list[str] = []
    for row in tasks:
        artifact = root / str(row["artifact_path"])
        if not artifact.is_file():
            raise SystemExit(f"Missing approved artifact: {artifact}")
        if sha256_file(artifact) != row.get("artifact_sha256"):
            raise SystemExit(f"Artifact changed after approval: {artifact}")
        body = artifact.read_text(encoding="utf-8").strip()
        if INTERNAL_MARKERS.search(body):
            raise SystemExit(f"Internal task marker found in {artifact}")
        bodies.append(body)
    output = root / str(chapter["output_path"])
    assembled = f"# {chapter['title_zh']}\n\n" + "\n\n".join(bodies) + "\n"
    atomic_write_text(output, assembled)
    chapter["status"] = "assembled"
    chapter["last_updated"] = now()
    write_jsonl(root / "manifests" / "chapters.jsonl", chapters)
    append_event(
        root,
        chapter=chapter_id,
        stage="assembled",
        artifact=str(chapter["output_path"]),
        result="completed",
        next_stage="user_approved",
    )
    print(f"Assembled {output} ({sha256_file(output)})")


def validate(root: Path, quiet: bool = False) -> list[str]:
    errors: list[str] = []
    required = (
        root / "project.json",
        root / "PROJECT.md",
        root / "sources" / "source-manifest.jsonl",
        root / "decisions" / "translation-decisions.jsonl",
        root / "decisions" / "terminology.tsv",
        root / "progress" / "events.jsonl",
        root / "manifests" / "chapters.jsonl",
        root / "manifests" / "tasks.jsonl",
        root / "manifests" / "releases.jsonl",
    )
    for path in required:
        if not path.exists():
            errors.append(f"missing: {path}")
    for name in SPEC_FILES:
        if not (root / "spec" / name).is_file():
            errors.append(f"missing active specification: spec/{name}")
    if errors:
        if not quiet:
            print("\n".join(errors))
        return errors
    try:
        project = load_project(root)
        current_spec_hash = spec_hash(root)
        if project.get("project_type") != "plain-language-reader-edition":
            errors.append("project_type is not plain-language-reader-edition")
        if project.get("spec_sha256") != current_spec_hash:
            errors.append(
                "active specification differs from project lock; "
                "migrate or record an explicit specification revision"
            )
        snapshot = root / str(project.get("skill_snapshot", ""))
        if not snapshot.is_dir() or not (snapshot / "SKILL.md").is_file():
            errors.append(f"missing skill snapshot: {snapshot}")
    except (ValueError, json.JSONDecodeError, OSError) as exc:
        errors.append(str(exc))
        project = {}
        current_spec_hash = ""
    try:
        chapter_rows = read_jsonl(root / "manifests" / "chapters.jsonl")
        task_rows = read_jsonl(root / "manifests" / "tasks.jsonl")
        release_rows = read_jsonl(root / "manifests" / "releases.jsonl")
        source_rows = read_jsonl(root / "sources" / "source-manifest.jsonl")
        read_jsonl(root / "progress" / "events.jsonl")
    except (ValueError, OSError) as exc:
        errors.append(str(exc))
        chapter_rows, task_rows, release_rows, source_rows = [], [], [], []
    source_ids: set[str] = set()
    for row in source_rows:
        source_id = str(row.get("source_id", ""))
        if not source_id or source_id in source_ids:
            errors.append(f"invalid or duplicate source_id: {source_id}")
            continue
        source_ids.add(source_id)
        if row.get("status") not in SOURCE_STATES:
            errors.append(f"{source_id}: invalid source status {row.get('status')}")
        local_path = str(row.get("local_path", ""))
        if not local_path:
            continue
        source_file = root / local_path
        if not source_file.is_file():
            errors.append(f"{source_id}: missing registered source {source_file}")
            continue
        if source_file.stat().st_size != row.get("bytes"):
            errors.append(f"{source_id}: registered byte length changed")
        if sha256_file(source_file) != row.get("sha256"):
            errors.append(f"{source_id}: registered SHA-256 changed")
    base_edition = str(project.get("base_edition", ""))
    if base_edition and base_edition not in source_ids:
        errors.append(f"base edition is not registered: {base_edition}")
    chapter_ids: set[str] = set()
    for row in chapter_rows:
        chapter_id = str(row.get("chapter_id", ""))
        if not chapter_id or chapter_id in chapter_ids:
            errors.append(f"invalid or duplicate chapter_id: {chapter_id}")
            continue
        chapter_ids.add(chapter_id)
        if row.get("status") not in CHAPTER_STATES:
            errors.append(f"{chapter_id}: invalid chapter status {row.get('status')}")
        source = root / str(row.get("source_path", ""))
        if not source.is_file():
            errors.append(f"{chapter_id}: missing source {source}")
        elif sha256_file(source) != row.get("source_sha256"):
            errors.append(f"{chapter_id}: base source hash changed")
    task_ids: set[str] = set()
    active_ranges: dict[str, list[tuple[int, int, str]]] = {}
    for row in task_rows:
        task_id = str(row.get("task_id", ""))
        chapter_id = str(row.get("chapter_id", ""))
        if not task_id or task_id in task_ids:
            errors.append(f"invalid or duplicate task_id: {task_id}")
            continue
        task_ids.add(task_id)
        if chapter_id not in chapter_ids:
            errors.append(f"{task_id}: unknown chapter {chapter_id}")
        if row.get("status") not in TASK_STATES:
            errors.append(f"{task_id}: invalid task status {row.get('status')}")
        package = root / str(row.get("task_package_path", ""))
        if not package.is_file():
            errors.append(f"{task_id}: missing task package {package}")
        elif str(row.get("source_sha256", "")) not in package.read_text(
            encoding="utf-8"
        ):
            errors.append(f"{task_id}: task package does not contain source hash")
        if row.get("spec_sha256") != current_spec_hash:
            errors.append(f"{task_id}: task specification hash is stale")
        if row.get("status") != "superseded":
            try:
                active_ranges.setdefault(chapter_id, []).append(
                    (
                        paragraph_number(str(row["start_paragraph"])),
                        paragraph_number(str(row["end_paragraph"])),
                        task_id,
                    )
                )
            except (KeyError, ValueError) as exc:
                errors.append(f"{task_id}: invalid range: {exc}")
        if row.get("status") in (
            "drafted",
            "meaning_reviewed",
            "readability_reviewed",
            "approved",
        ):
            artifact = root / str(row.get("artifact_path", ""))
            if not artifact.is_file():
                errors.append(f"{task_id}: missing draft artifact")
            elif sha256_file(artifact) != row.get("artifact_sha256"):
                errors.append(f"{task_id}: draft artifact hash mismatch")
    for chapter_id, ranges in active_ranges.items():
        ranges.sort()
        for previous, current in zip(ranges, ranges[1:]):
            if current[0] <= previous[1]:
                errors.append(
                    f"{chapter_id}: overlapping tasks {previous[2]} and {current[2]}"
                )
    for row in release_rows:
        output = root / str(row.get("output_path", ""))
        if not output.is_file():
            errors.append(f"release missing output: {output}")
        elif sha256_file(output) != row.get("sha256"):
            errors.append(f"released output hash mismatch: {output}")
    if not quiet:
        if errors:
            print("\n".join(errors))
        else:
            print(
                f"OK: {project.get('project_id')} | "
                f"chapters {len(chapter_rows)} | tasks {len(task_rows)} | "
                f"spec {current_spec_hash[:12]}"
            )
    return errors


def context(root: Path, chapter_id: str | None) -> None:
    errors = validate(root, quiet=True)
    project = load_project(root)
    chapters = read_jsonl(root / "manifests" / "chapters.jsonl")
    tasks = read_jsonl(root / "manifests" / "tasks.jsonl")
    events = read_jsonl(root / "progress" / "events.jsonl")[-20:]
    if chapter_id:
        chapters = [
            row for row in chapters if row.get("chapter_id") == chapter_id
        ]
        tasks = [row for row in tasks if row.get("chapter_id") == chapter_id]
        events = [
            row
            for row in events
            if row.get("chapter") in ("", chapter_id)
        ]
    pending = [
        row
        for row in tasks
        if row.get("status") not in ("approved", "superseded")
    ]
    print(
        json.dumps(
            {
                "validation": "ok" if not errors else errors,
                "project": {
                    key: project.get(key)
                    for key in (
                        "project_id",
                        "title",
                        "status",
                        "target_reader",
                        "standard_version",
                        "spec_sha256",
                    )
                },
                "chapters": chapters,
                "next_tasks": pending[:5],
                "last_events": events,
                "resume_rule": (
                    "Read active spec and the first pending task package; "
                    "continue from files, not chat memory."
                ),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def status(root: Path) -> None:
    chapters = read_jsonl(root / "manifests" / "chapters.jsonl")
    tasks = read_jsonl(root / "manifests" / "tasks.jsonl")
    summary: list[dict[str, Any]] = []
    for chapter in chapters:
        chapter_tasks = [
            row for row in tasks if row.get("chapter_id") == chapter["chapter_id"]
        ]
        counts = {
            state: sum(row.get("status") == state for row in chapter_tasks)
            for state in TASK_STATES
            if any(row.get("status") == state for row in chapter_tasks)
        }
        summary.append(
            {
                "chapter": chapter["chapter_id"],
                "title": chapter["title_zh"],
                "status": chapter["status"],
                "tasks": counts,
            }
        )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name in ("migrate", "validate", "status"):
        subparser = subparsers.add_parser(name)
        subparser.add_argument("project_root", type=Path)
    context_parser = subparsers.add_parser("context")
    context_parser.add_argument("project_root", type=Path)
    context_parser.add_argument("--chapter")
    task_parser = subparsers.add_parser("make-tasks")
    task_parser.add_argument("project_root", type=Path)
    task_parser.add_argument("chapter")
    task_parser.add_argument("--max-paragraphs", type=int, default=5)
    task_parser.add_argument("--title")
    update_parser = subparsers.add_parser("task-update")
    update_parser.add_argument("project_root", type=Path)
    update_parser.add_argument("task_id")
    update_parser.add_argument("--status", required=True)
    update_parser.add_argument("--artifact-path")
    update_parser.add_argument("--review-path")
    chapter_parser = subparsers.add_parser("chapter-advance")
    chapter_parser.add_argument("project_root", type=Path)
    chapter_parser.add_argument("chapter")
    chapter_parser.add_argument("--status", required=True)
    assemble_parser = subparsers.add_parser("assemble")
    assemble_parser.add_argument("project_root", type=Path)
    assemble_parser.add_argument("chapter")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    root = args.project_root.resolve()
    if args.command == "migrate":
        migrate(root)
    elif args.command == "validate":
        return 1 if validate(root) else 0
    elif args.command == "context":
        context(root, args.chapter)
    elif args.command == "status":
        status(root)
    elif args.command == "make-tasks":
        make_tasks(root, args.chapter, args.max_paragraphs, args.title)
    elif args.command == "task-update":
        task_update(
            root,
            args.task_id,
            args.status,
            args.artifact_path,
            args.review_path,
        )
    elif args.command == "chapter-advance":
        chapter_advance(root, args.chapter, args.status)
    elif args.command == "assemble":
        assemble(root, args.chapter)
    else:
        raise AssertionError(args.command)
    return 0


if __name__ == "__main__":
    sys.exit(main())
