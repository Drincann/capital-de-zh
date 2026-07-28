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


STANDARD_VERSION = "reader-edition-v18"
SPEC_FILES = (
    "reader-edition-standard.md",
    "review-protocol.md",
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
REVIEW_FIELDS = (
    "Review-Type",
    "Task-ID",
    "Draft-SHA256",
    "Verdict",
)
MEANING_REVIEW_HEADINGS = (
    "Source argument map",
    "Claim and logic audit",
    "Changes and uncertainty",
)
READABILITY_REVIEW_HEADINGS = (
    "One-read paraphrases",
    "Reader questions",
    "Transition evidence",
    "Scope and closure audit",
    "Second-read risks",
    "Paragraph and punctuation audit",
)
SCOPE_TRIGGER = re.compile(
    r"不影响|不区分|无论|不论|不管|撇开|放在一边|"
    r"暂时不|暂不|排除"
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
4. Save meaning and readability reviews as separate Markdown files. Each review
   must contain the required evidence and exact draft hash.
5. Update task status only after the controller validates the review content,
   not merely the file's existence.
6. Assemble a chapter only from approved tasks with unchanged hashes.
7. Before registering a candidate version, require a hash-bound review from an
   independent reader context that saw only the assembled Chinese. The reader
   tests translation clarity, not whether the source has proved its theory.
   A candidate may be returned for revision at most twice. Style suggestions do
   not fail it. A third blocking FAIL registers the exact final candidate as
   `needs_review`, attaches a concise issue note, and does not pause the batch.
8. Never overwrite an approved release silently. Create a new task revision and
   append a progress event and decision.
"""


RELEASE_TEXT = """# Release policy

The public edition consists only of UTF-8 Markdown files under `reader-edition/`,
one file per chapter.

A chapter may be released only when:

- every source paragraph is covered once, with no gap or overlap;
- every task is approved after hash-bound, evidence-based meaning and
  source-blind readability review;
- every registered candidate has a hash-bound independent-reader review; a
  bounded third FAIL is marked `needs_review`, is visible for later reader
  judgment, and cannot be auto-adopted or released;
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


def source_blocks_with_referenced_notes(
    source_path: Path,
    group: list[dict[str, str]],
) -> str:
    """Return source items plus the source notes they explicitly cite.

    Extracted MEGAdigital files keep footnotes in a trailing section so stable
    paragraph IDs do not change. Translation tasks still need the actual note
    text, not only a marker such as ``29)``.
    """

    source_blocks = "\n\n".join(item["block"] for item in group)
    full_text = source_path.read_text(encoding="utf-8")
    if "\n## Footnotes" not in full_text:
        return source_blocks
    footnote_text = full_text.split("\n## Footnotes", 1)[1]
    note_header = re.compile(
        r"^\[(?P<id>note-\d+)\]\s+(?P<locator>[^\n]*)\n",
        re.MULTILINE,
    )
    matches = list(note_header.finditer(footnote_text))
    note_entries: list[dict[str, str]] = []
    for index, match in enumerate(matches):
        end = (
            matches[index + 1].start()
            if index + 1 < len(matches)
            else len(footnote_text)
        )
        body = footnote_text[match.end() : end].strip()
        label_match = re.match(r"(?P<label>\d+[a-z]?)\)", body)
        if label_match:
            note_entries.append(
                {
                    "id": match.group("id"),
                    "locator": match.group("locator").strip(),
                    "body": body,
                    "label": label_match.group("label"),
                }
            )
    defined_labels = {entry["label"] for entry in note_entries}
    referenced_labels = set(
        re.findall(r"(?<![\w])(\d+[a-z]?)\)", source_blocks)
    )
    selected: list[str] = []
    for entry in note_entries:
        label = entry["label"]
        resolved_label = label if label in referenced_labels else ""
        if not resolved_label:
            # A historical print/XML record can retain a trailing letter at
            # the reference point but omit it from the note definition. Only
            # accept a unique one-letter variant with no exact definition.
            variants = sorted(
                candidate
                for candidate in referenced_labels
                if re.fullmatch(rf"{re.escape(label)}[a-z]", candidate)
                and candidate not in defined_labels
            )
            if len(variants) == 1:
                resolved_label = variants[0]
        if resolved_label:
            body = re.sub(
                r"^\d+[a-z]?\)",
                f"{resolved_label})",
                entry["body"],
                count=1,
            )
            selected.append(
                f"[{entry['id']}] {entry['locator']}\n{body}"
            )
    if not selected:
        return source_blocks
    return (
        source_blocks
        + "\n\n## Referenced source notes\n\n"
        + "\n\n".join(selected)
    )


def source_from_task_package(path: Path) -> str:
    """Recover the exact source slice embedded in an existing task package."""

    text = path.read_text(encoding="utf-8")
    match = re.search(
        r"## Exact German source\s+```text\n(?P<source>.*?)\n```\s+"
        r"## Acceptance gates",
        text,
        re.DOTALL,
    )
    if not match:
        raise ValueError(f"cannot locate exact source in task package: {path}")
    return match.group("source")


def normalized_source_identity(text: str) -> str:
    """Normalize extraction metadata without hiding source-content changes.

    Stable paragraph IDs, printed note labels, and all German wording remain in
    the identity. Internal note IDs, MEGA page locators, and typographic quote
    variants may change when the XML extractor is repaired and must not force a
    completed translation through another review cycle.
    """

    text = re.sub(
        r"(?m)^(\[v1-[^\]]+\])\s+\[MEGA[^\]]*\]\s*$",
        r"\1",
        text,
    )
    text = re.sub(
        r"(?m)^\[note-\d+\]\s+\[MEGA[^\]]*\]\s*$",
        "[note]",
        text,
    )
    text = text.translate(
        str.maketrans(
            {
                "“": '"',
                "”": '"',
                "„": '"',
                "‟": '"',
                "«": '"',
                "»": '"',
                "’": "'",
                "‘": "'",
            }
        )
    )
    return "\n".join(line.rstrip() for line in text.strip().splitlines())


def review_field(text: str, name: str) -> str:
    match = re.search(
        rf"^{re.escape(name)}:\s*`?([^`\r\n]+?)`?\s*$",
        text,
        re.MULTILINE,
    )
    return match.group(1).strip() if match else ""


def review_section(text: str, heading: str) -> str:
    match = re.search(
        rf"^## {re.escape(heading)}\s*$\n(?P<body>.*?)(?=^## |\Z)",
        text,
        re.MULTILINE | re.DOTALL,
    )
    return match.group("body").strip() if match else ""


def chinese_prose_blocks(text: str) -> list[str]:
    blocks: list[str] = []
    in_fence = False
    current: list[str] = []

    def flush() -> None:
        if not current:
            return
        block = "\n".join(current).strip()
        current.clear()
        if (
            block
            and not block.startswith("#")
            and not block.startswith("〔译者注：")
            and not (block.startswith(">") and "=" in block)
            and re.search(r"[\u3400-\u9fff]", block)
        ):
            blocks.append(block)

    for line in text.splitlines():
        if line.strip().startswith("```"):
            flush()
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if not line.strip():
            flush()
            continue
        current.append(line)
    flush()
    return blocks


def chinese_sentences(block: str) -> list[str]:
    normalized = re.sub(r"\s+", " ", block).strip()
    return [
        item.strip()
        for item in re.split(r"(?<=[。！？])", normalized)
        if re.search(r"[\u3400-\u9fff]", item)
    ]


def review_errors(
    root: Path,
    row: dict[str, Any],
    review_path: Path,
    review_type: str,
    allow_fail: bool = False,
) -> list[str]:
    errors: list[str] = []
    text = review_path.read_text(encoding="utf-8")
    artifact = root / str(row["artifact_path"])
    draft_text = artifact.read_text(encoding="utf-8")
    draft_hash = sha256_file(artifact)

    if re.search(
        r"\bTODO\b|\bTBD\b|待补(?:充|写|译)?|占位(?:符|内容|文本|项)",
        text,
        re.IGNORECASE,
    ):
        errors.append("review contains a placeholder")
    for field in REVIEW_FIELDS:
        if not review_field(text, field):
            errors.append(f"missing review field: {field}")
    if review_field(text, "Review-Type") != review_type:
        errors.append(f"Review-Type must be {review_type}")
    if review_field(text, "Task-ID") != row.get("task_id"):
        errors.append("Task-ID does not match")
    if review_field(text, "Draft-SHA256") != draft_hash:
        errors.append("Draft-SHA256 does not match the current draft")
    verdict = review_field(text, "Verdict")
    if verdict != "PASS" and not (allow_fail and verdict == "FAIL"):
        errors.append("Verdict must be PASS before advancing")

    if review_type == "meaning":
        for heading in MEANING_REVIEW_HEADINGS:
            if not review_section(text, heading):
                errors.append(f"missing or empty section: {heading}")
        package = root / str(row["task_package_path"])
        source_ids = list(
            dict.fromkeys(PARAGRAPH_HEADER.findall(package.read_text(encoding="utf-8")))
        )
        # PARAGRAPH_HEADER.findall returns tuples because the pattern has two groups.
        ids = [item[0] if isinstance(item, tuple) else item for item in source_ids]
        argument_map = review_section(text, "Source argument map")
        for source_id in ids:
            if not re.search(
                rf"^-\s+\[{re.escape(source_id)}\]:\s*\S",
                argument_map,
                re.MULTILINE,
            ):
                errors.append(f"missing source argument-map entry: {source_id}")
        return errors

    for heading in READABILITY_REVIEW_HEADINGS:
        if not review_section(text, heading):
            errors.append(f"missing or empty section: {heading}")
    if review_field(text, "Source-Blind") != "YES":
        errors.append("Source-Blind must be YES")

    blocks = chinese_prose_blocks(draft_text)
    paraphrases = review_section(text, "One-read paraphrases")
    questions = review_section(text, "Reader questions")
    transitions = review_section(text, "Transition evidence")
    scope_audit = review_section(text, "Scope and closure audit")
    punctuation = review_section(text, "Paragraph and punctuation audit")

    for index, block in enumerate(blocks, 1):
        label = f"C{index}"
        if not re.search(
            rf"^-\s+{label}:\s*\S", paraphrases, re.MULTILINE
        ):
            errors.append(f"missing one-read paraphrase: {label}")
        if not re.search(
            rf"^-\s+{label}\s+Q:\s*\S.+\s+A:\s*\S",
            questions,
            re.MULTILINE,
        ):
            errors.append(f"missing reader question and answer: {label}")
        sentences = chinese_sentences(block)
        if len(sentences) > 1:
            transition_line = re.search(
                rf"^-\s+{label}:\s*(?P<body>.+)$",
                transitions,
                re.MULTILINE,
            )
            if not transition_line:
                errors.append(f"missing transition evidence: {label}")
            else:
                body = transition_line.group("body")
                for sentence_index in range(1, len(sentences)):
                    marker = f"S{sentence_index}->S{sentence_index + 1}="
                    if marker not in body:
                        errors.append(
                            f"missing transition marker {label} {marker[:-1]}"
                        )
        if SCOPE_TRIGGER.search(block):
            scope_line = re.search(
                rf"^-\s+{label}:\s*(?P<body>.+)$",
                scope_audit,
                re.MULTILINE,
            )
            if not scope_line:
                errors.append(f"missing scope-and-closure entry: {label}")
            else:
                body = scope_line.group("body")
                if "scope=" not in body or "invariant=" not in body or "anchor=" not in body:
                    errors.append(
                        f"scope entry must include scope, invariant, and anchor: {label}"
                    )
                else:
                    anchor = body.split("anchor=", 1)[1].strip()
                    anchor = anchor.strip("`\"'“”")
                    if not anchor or anchor not in block:
                        errors.append(
                            f"scope anchor is not an exact phrase from {label}"
                        )

    risks = review_section(text, "Second-read risks")
    if not allow_fail and not re.search(
        r"^-\s+(?:None in current draft\.|No unresolved T(?: findings)?\.)",
        risks,
        re.MULTILINE,
    ):
        errors.append(
            "a passing readability review must state either "
            "'- None in current draft.' or '- No unresolved T findings.' "
            "under Second-read risks"
        )
    semicolon_match = re.search(
        r"^-\s*Semicolons:\s*(\d+)\s*$|^Semicolons:\s*(\d+)\s*$",
        punctuation,
        re.MULTILINE,
    )
    if not semicolon_match:
        errors.append("Paragraph and punctuation audit must record Semicolons")
    elif int(semicolon_match.group(1) or semicolon_match.group(2)) != draft_text.count("；"):
        errors.append("recorded semicolon count does not match the draft")
    if not re.search(
        r"^(?:-\s*)?Boundary-Changes:\s*\S", punctuation, re.MULTILINE
    ):
        errors.append(
            "Paragraph and punctuation audit must record Boundary-Changes"
        )
    return errors


def independent_review_errors(
    unit_id: str,
    artifact_text: str,
    review_path: Path,
    allow_fail: bool = False,
) -> list[str]:
    errors: list[str] = []
    text = review_path.read_text(encoding="utf-8")
    artifact_hash = sha256_text(artifact_text)
    required_fields = (
        "Review-Type",
        "Unit-ID",
        "Artifact-SHA256",
        "Reviewer-Context",
        "Source-Access",
        "Verdict",
    )
    required_headings = (
        "Overall assessment",
        "Paragraph findings",
        "Failure probes",
    )
    if re.search(
        r"\bTODO\b|\bTBD\b|待补(?:充|写|译)?|占位(?:符|内容|文本|项)",
        text,
        re.IGNORECASE,
    ):
        errors.append("independent review contains a placeholder")
    for field in required_fields:
        if not review_field(text, field):
            errors.append(f"missing independent review field: {field}")
    if review_field(text, "Review-Type") != "independent-reader":
        errors.append("Review-Type must be independent-reader")
    if review_field(text, "Unit-ID") != unit_id:
        errors.append("Unit-ID does not match")
    if review_field(text, "Artifact-SHA256") != artifact_hash:
        errors.append("Artifact-SHA256 does not match the assembled text")
    if not review_field(text, "Reviewer-Context"):
        errors.append("Reviewer-Context must identify the fresh reader context")
    if review_field(text, "Source-Access") != "NO":
        errors.append("Source-Access must be NO")
    verdict = review_field(text, "Verdict")
    if verdict not in ("PASS", "FAIL"):
        errors.append("independent reader Verdict must be PASS or FAIL")
    elif verdict == "FAIL" and not allow_fail:
        errors.append(
            "independent reader FAIL requires bounded-final registration"
        )
    for heading in required_headings:
        if not review_section(text, heading):
            errors.append(f"missing or empty independent section: {heading}")
    return errors


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
        root / "manifests" / "unit-versions.jsonl",
        root / "manifests" / "unit-version-reviews.jsonl",
        root / "manifests" / "releases.jsonl",
        root / "decisions" / "translation-decisions.jsonl",
        root / "progress" / "events.jsonl",
    ):
        if not path.exists():
            atomic_write_text(path, "")


def install_spec(root: Path) -> None:
    standard_source = skill_root() / "references" / "translation-standard.md"
    review_source = skill_root() / "references" / "review-protocol.md"
    targets = {
        "reader-edition-standard.md": standard_source.read_text(encoding="utf-8"),
        "review-protocol.md": review_source.read_text(encoding="utf-8"),
        "workflow.md": WORKFLOW_TEXT,
        "release-policy.md": RELEASE_TEXT,
    }
    for name, content in targets.items():
        path = root / "spec" / name
        expected = content.rstrip() + "\n"
        if not path.exists() or path.read_text(encoding="utf-8") != expected:
            atomic_write_text(path, expected)


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
    for chapter_dir in sorted((root / "chapters").glob("ch*")):
        if not chapter_dir.is_dir():
            continue
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
        section_match = re.fullmatch(r"(ch\d{2})s\d{2}", chapter_id)
        logical_chapter_id = (
            section_match.group(1) if section_match else chapter_id
        )
        title = CHAPTER_TITLES.get(logical_chapter_id, chapter_id)
        output_path = (
            f"chapters/{chapter_id}/assembled.md"
            if section_match
            else f"reader-edition/{title}.md"
        )
        row = existing.get(chapter_id, {})
        row.update(
            {
                "chapter_id": chapter_id,
                "title_zh": title,
                "source_path": relative(root, source_path),
                "source_sha256": sha256_file(source_path),
                "status": row.get("status") or "source_locked",
                "output_path": output_path,
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
            "target_reader": "无经济学、哲学或马克思主义理论专业背景的普通大学生",
            "final_format": "markdown-one-file-per-chapter",
            "translation_policy": (
                "忠实于德文的核心命题、逻辑关系、必要概念区别和论证性证据，"
                "不追求词语、句法、局部顺序或段落相似；默认使用最短、最直接的"
                "自然中文，并可重组句段、显化原文蕴含的中间步骤和压缩无论证作用的"
                "重复；不得替原文补证明、提前展开后文或改变理论"
            ),
            "inline_note_syntax": "〔译者注：……〕",
            "standard_version": STANDARD_VERSION,
            "skill_snapshot": snapshot_path,
            "spec_sha256": spec_hash(root),
            "status": "reader-edition-spec-locked",
            "final_review_policy": (
                "独立终审最多打回两次；第三次仍有阻断问题时登记为"
                "needs_review并附版本问题摘要，不暂停批量翻译，不自动采用或发布"
            ),
            "last_updated": now(),
        }
    )
    write_json(root / "project.json", project)
    project_md = f"""# {project.get('title', '《资本论》现代汉语读者版')}

本项目从可靠的德文文本出发，制作一套面向普通读者的现代汉语通俗新译。
目标读者不需要预先学过经济学、哲学或马克思主义术语。

最终公开成果位于 `reader-edition/`，每章一个 Markdown 文件。原文、版本
核对、任务包、草稿、校对和决策记录全部留在后台，不进入读者正文。

翻译忠实于德文的核心命题、逻辑关系、必要概念区别和论证性证据，不追
求词语、句法、局部顺序或段落相似。默认写成最短、最直接的自然中文；
词类转换、把抽象名词改成动作、重组句段、显化原文蕴含的中间步骤、压
缩无论证作用的重复都属于正常翻译。不得替原文补证明、提前展开后文，
或改变核心命题、关系、概念、事实、数字和引文。

审核只拦截会造成误解的实质性问题。较短、较顺或不同措辞只作为非阻断
建议。一个任务或候选版本最多打回修改两次；终审仍有实质性问题时停止
自动修改。若独立终审仍有实质性问题，则把最终候选登记为待复核版本，
附上问题摘要并继续后续单元；通过终审的版本不显示问题摘要。

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
    decisions: str,
) -> str:
    return f"""# Reader-edition translation task {row['task_id']}

## Immutable task metadata

- Chapter: `{chapter['chapter_id']}` — {chapter['title_zh']}
- Paragraphs: `{row['start_paragraph']}` through `{row['end_paragraph']}`
- Source slice SHA-256: `{row['source_sha256']}`
- Active specification SHA-256: `{row['spec_sha256']}`
- Draft output: `{row['artifact_path']}`

## Reader contract

Write for an ordinary undergraduate with no specialist background. Produce
direct, natural, present-day Chinese. The reader should be able to paraphrase
each paragraph after one reading.

Preserve the German source's core claims, logical relations, indispensable
distinctions, and argument-bearing evidence—not its wording, syntax, local
sentence order, paragraphing, repetition, or nonessential rhetoric. Write the
shortest direct natural Chinese that preserves the argument. Changing parts of
speech, replacing abstract nouns with actions, combining or reordering
sentences, making an entailed intermediate step explicit, changing paragraph
boundaries for a clear reading function, and compressing repetition without
argumentative work are routine translation.

Use semicolons sparingly. Keep one only when it makes a direct parallel or
contrast clearer than a period and explicit connector. Do not use semicolons to
compress separate reasoning steps or imitate German sentence length.

Before drafting, identify the passage's argument spine: its question, stable
conceptual subject, the function of each step, and why each sentence follows the
previous one. Keep that spine visible in Chinese. Do not leave the reader to
reconnect individually clear sentences after a silent change of subject or
viewpoint.

You may naturalize word order, change word class, replace source-shaped
abstractions with concrete Chinese, split or combine sentences, name implicit
subjects, reorder nearby claims and qualifications, and add a connector or
intermediate step already entailed by the passage. Apply a shorter-without-loss
test during drafting. Preserve every argument-bearing step, fact, figure,
quotation, key example, and scope-changing qualification. Never repair an
authorial theoretical gap, make the argument more persuasive, or import later
theory into the main text.

Use `〔译者注：……〕` only to prevent a likely misunderstanding, add essential
historical context, or mark a real interpretive choice. Keep notes short and
sparse.

Write only the reader-facing Chinese body to the draft output. Do not include
German, paragraph IDs, task metadata, QA notes, or a separate guide.

If an important term has no approved project decision, use the clearest
provisional wording, explain it naturally at first use if necessary, and list the
proposal in the meaning review. Do not silently turn it into a global default.

## Active terminology and decisions

```text
{decisions.strip() or '(none recorded)'}
```

## Exact German source

```text
{source_blocks}
```

## Acceptance gates

1. Meaning audit against the exact German source.
2. Source-blind one-read comprehension audit with one paraphrase, one reader
   question, and complete adjacent-sentence relation evidence for every Chinese
   prose paragraph. Classify findings as blocking translation defects, style
   suggestions, authorial difficulties, or deferred questions; only blocking
   translation defects fail.
3. Paragraph-boundary audit; verify source coverage and record the reading
   function of every split or join.
4. Semicolon replacement audit.
5. Translator-note necessity audit.
6. Scope-and-closure audit: every bracketed distinction must name what is set
   aside and quote the exact Chinese anchor that returns to the common point.
7. Bind both reviews to the exact draft SHA-256 using the format in
   `references/review-protocol.md`.
8. Save each review under `chapters/{chapter['chapter_id']}/reviews/`.
9. After writing the assigned artifact, report its path and stop. Durable status
   updates belong to the coordinating main agent and are intentionally omitted
   from this delegated task package.
10. A task may be returned for revision at most twice. Resolve task-level
    blocking defects before assembly; do not turn style suggestions into an
    endless optimization loop.
"""


def active_decisions(root: Path) -> str:
    parts: list[str] = []
    terminology_path = root / "decisions" / "terminology.tsv"
    if terminology_path.is_file():
        parts.append(terminology_path.read_text(encoding="utf-8").strip())
    decisions_path = root / "decisions" / "translation-decisions.jsonl"
    if decisions_path.is_file():
        approved = [
            json.dumps(row, ensure_ascii=False)
            for row in read_jsonl(decisions_path)
            if row.get("status") == "approved"
        ]
        if approved:
            parts.append("\n".join(approved))
    return "\n\n".join(part for part in parts if part)


def make_tasks(
    root: Path,
    chapter_id: str,
    max_paragraphs: int,
    title: str | None = None,
    replace_incomplete: bool = False,
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
    replaced: list[dict[str, Any]] = []
    if active and not replace_incomplete:
        raise SystemExit(
            f"{chapter_id} already has {len(active)} active tasks; "
            "supersede or finish them before rechunking"
        )
    if active:
        blocked = [
            str(row.get("task_id", ""))
            for row in active
            if row.get("status") not in ("pending", "in_progress", "drafted")
            or row.get("meaning_review_path")
            or row.get("readability_review_path")
        ]
        if blocked:
            raise SystemExit(
                "Only pending, in-progress, or unreviewed drafted tasks may be "
                "replaced while rechunking: "
                + ", ".join(blocked)
            )
        replaced = list(active)
        for row in replaced:
            row["status"] = "superseded"
            row["last_updated"] = now()

    source_path = root / str(chapter["source_path"])
    paragraphs = parse_source(source_path)
    current_spec_hash = spec_hash(root)
    decisions = active_decisions(root)
    created: list[dict[str, Any]] = []
    for index in range(0, len(paragraphs), max_paragraphs):
        group = paragraphs[index : index + max_paragraphs]
        source_blocks = source_blocks_with_referenced_notes(source_path, group)
        first_num = paragraph_number(group[0]["id"])
        last_num = paragraph_number(group[-1]["id"])
        previous_revisions = [
            int(row.get("revision", 1))
            for row in all_tasks
            if row.get("chapter_id") == chapter_id
            and row.get("start_paragraph") == group[0]["id"]
            and row.get("end_paragraph") == group[-1]["id"]
        ]
        revision = max(previous_revisions, default=0) + 1
        task_id = (
            f"{chapter_id}-p{first_num:04d}-p{last_num:04d}-r{revision}"
        )
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
            "meaning_review_sha256": "",
            "readability_review_sha256": "",
            "meaning_review_artifact_sha256": "",
            "readability_review_artifact_sha256": "",
            "dependencies": [
                str(row["task_id"])
                for row in replaced
                if (
                    paragraph_number(str(row["start_paragraph"])) <= last_num
                    and paragraph_number(str(row["end_paragraph"])) >= first_num
                )
            ],
            "revision": revision,
            "last_updated": now(),
        }
        atomic_write_text(
            task_package,
            task_package_text(
                row=row,
                chapter=chapter,
                source_blocks=source_blocks,
                decisions=decisions,
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
        stage=(
            "task-rechunking"
            if replace_incomplete and replaced
            else "task-chunking"
        ),
        artifact=f"chapters/{chapter_id}/tasks",
        result=(
            f"completed:{len(created)};superseded:{len(replaced)}"
            if replaced
            else f"completed:{len(created)}"
        ),
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


def refresh_tasks(
    root: Path,
    chapter_id: str,
    task_ids: list[str] | None = None,
) -> None:
    chapter_rows = read_jsonl(root / "manifests" / "chapters.jsonl")
    chapter = next(
        (row for row in chapter_rows if row.get("chapter_id") == chapter_id), None
    )
    if chapter is None:
        raise SystemExit(f"Unknown chapter: {chapter_id}")
    task_path = root / "manifests" / "tasks.jsonl"
    task_rows = read_jsonl(task_path)
    selected = [
        row
        for row in task_rows
        if row.get("chapter_id") == chapter_id
        and row.get("status") != "superseded"
    ]
    if task_ids:
        wanted = set(task_ids)
        available = {str(row.get("task_id", "")) for row in selected}
        missing = sorted(wanted - available)
        if missing:
            raise SystemExit(
                "Unknown active task(s) for "
                f"{chapter_id}: {', '.join(missing)}"
            )
        selected = [
            row for row in selected if str(row.get("task_id", "")) in wanted
        ]
    if not selected:
        raise SystemExit(f"{chapter_id} has no tasks to refresh")
    blocked = [
        row["task_id"]
        for row in selected
        if row.get("status") not in ("pending", "in_progress", "drafted")
        or row.get("meaning_review_path")
        or row.get("readability_review_path")
    ]
    if blocked:
        raise SystemExit(
            "Only pending, in-progress, or drafted tasks without reviews can be "
            "refreshed in place: "
            + ", ".join(blocked)
        )
    paragraphs = parse_source(root / str(chapter["source_path"]))
    ids = [item["id"] for item in paragraphs]
    current_spec_hash = spec_hash(root)
    decisions = active_decisions(root)
    for row in selected:
        try:
            start = ids.index(str(row["start_paragraph"]))
            end = ids.index(str(row["end_paragraph"]))
        except ValueError as exc:
            raise SystemExit(
                f"{row['task_id']}: source range no longer exists"
            ) from exc
        group = paragraphs[start : end + 1]
        source_blocks = source_blocks_with_referenced_notes(
            root / str(chapter["source_path"]),
            group,
        )
        row["source_sha256"] = sha256_text(source_blocks)
        row["spec_sha256"] = current_spec_hash
        row["last_updated"] = now()
        package = root / str(row["task_package_path"])
        atomic_write_text(
            package,
            task_package_text(
                row=row,
                chapter=chapter,
                source_blocks=source_blocks,
                decisions=decisions,
            ),
        )
    write_jsonl(task_path, task_rows)
    append_event(
        root,
        chapter=chapter_id,
        stage="active-task-refresh",
        artifact=f"chapters/{chapter_id}/tasks",
        result=f"completed:{len(selected)}",
        next_stage="draft",
    )
    print(f"Refreshed {len(selected)} active tasks for {chapter_id}")


def revise_tasks(
    root: Path,
    chapter_id: str,
    allow_incomplete: bool = False,
    task_ids: list[str] | None = None,
) -> None:
    chapter_path = root / "manifests" / "chapters.jsonl"
    chapter_rows = read_jsonl(chapter_path)
    chapter = next(
        (row for row in chapter_rows if row.get("chapter_id") == chapter_id), None
    )
    if chapter is None:
        raise SystemExit(f"Unknown chapter: {chapter_id}")

    task_path = root / "manifests" / "tasks.jsonl"
    task_rows = read_jsonl(task_path)
    active = [
        row
        for row in task_rows
        if row.get("chapter_id") == chapter_id
        and row.get("status") != "superseded"
    ]
    if task_ids:
        wanted = set(task_ids)
        available = {str(row.get("task_id", "")) for row in active}
        missing = sorted(wanted - available)
        if missing:
            raise SystemExit(
                "Unknown active task(s) for "
                f"{chapter_id}: {', '.join(missing)}"
            )
        active = [
            row for row in active if str(row.get("task_id", "")) in wanted
        ]
    if not active:
        raise SystemExit(f"{chapter_id} has no active tasks to revise")
    blocked = [
        str(row["task_id"])
        for row in active
        if row.get("status") != "approved"
    ]
    if blocked and not allow_incomplete:
        raise SystemExit(
            "Revision requires every active task to be approved: "
            + ", ".join(blocked)
        )

    paragraphs = parse_source(root / str(chapter["source_path"]))
    ids = [item["id"] for item in paragraphs]
    current_spec_hash = spec_hash(root)
    decisions = active_decisions(root)
    created: list[dict[str, Any]] = []

    for old in active:
        try:
            start = ids.index(str(old["start_paragraph"]))
            end = ids.index(str(old["end_paragraph"]))
        except ValueError as exc:
            raise SystemExit(
                f"{old['task_id']}: source range no longer exists"
            ) from exc
        group = paragraphs[start : end + 1]
        source_blocks = source_blocks_with_referenced_notes(
            root / str(chapter["source_path"]),
            group,
        )
        revisions = [
            int(row.get("revision", 1))
            for row in task_rows
            if row.get("chapter_id") == chapter_id
            and row.get("start_paragraph") == old.get("start_paragraph")
            and row.get("end_paragraph") == old.get("end_paragraph")
        ]
        revision = max(revisions, default=0) + 1
        first_num = paragraph_number(str(old["start_paragraph"]))
        last_num = paragraph_number(str(old["end_paragraph"]))
        task_id = (
            f"{chapter_id}-p{first_num:04d}-p{last_num:04d}-r{revision}"
        )
        task_package = (
            root / "chapters" / chapter_id / "tasks" / f"{task_id}.md"
        )
        artifact = (
            root / "chapters" / chapter_id / "drafts" / f"{task_id}.md"
        )
        row = {
            "task_id": task_id,
            "chapter_id": chapter_id,
            "start_paragraph": old["start_paragraph"],
            "end_paragraph": old["end_paragraph"],
            "task_package_path": relative(root, task_package),
            "base_source_path": str(chapter["source_path"]),
            "source_sha256": sha256_text(source_blocks),
            "spec_sha256": current_spec_hash,
            "status": "pending",
            "artifact_path": relative(root, artifact),
            "artifact_sha256": "",
            "meaning_review_path": "",
            "readability_review_path": "",
            "meaning_review_sha256": "",
            "readability_review_sha256": "",
            "meaning_review_artifact_sha256": "",
            "readability_review_artifact_sha256": "",
            "dependencies": [str(old["task_id"])],
            "revision": revision,
            "last_updated": now(),
        }
        atomic_write_text(
            task_package,
            task_package_text(
                row=row,
                chapter=chapter,
                source_blocks=source_blocks,
                decisions=decisions,
            ),
        )
        old["status"] = "superseded"
        old["last_updated"] = now()
        created.append(row)

    task_rows.extend(created)
    write_jsonl(task_path, task_rows)
    chapter["status"] = "chunked"
    chapter["last_updated"] = now()
    write_jsonl(chapter_path, chapter_rows)
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
        stage="task-revision",
        artifact=f"chapters/{chapter_id}/tasks",
        result=f"created:{len(created)}",
        next_stage="draft",
    )
    print(
        json.dumps(
            {
                "chapter": chapter_id,
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
    allow_unresolved_final: bool = False,
    review_note: str = "",
) -> None:
    if new_status not in TASK_STATES:
        raise SystemExit(f"Invalid task status: {new_status}")
    if allow_unresolved_final and new_status != "readability_reviewed":
        raise SystemExit(
            "--allow-unresolved-final is only valid for readability_reviewed"
        )
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
        failures = review_errors(root, row, review, "meaning")
        if failures:
            raise SystemExit(
                "Meaning review failed validation:\n- "
                + "\n- ".join(failures)
            )
        row["meaning_review_path"] = review_path.replace("\\", "/")
        row["meaning_review_sha256"] = sha256_file(review)
        row["meaning_review_artifact_sha256"] = sha256_file(artifact)
    if new_status == "readability_reviewed":
        if not review_path:
            raise SystemExit("--review-path is required for readability_reviewed")
        review = root / review_path
        if not review.is_file():
            raise SystemExit(f"Readability review does not exist: {review}")
        if row.get("meaning_review_artifact_sha256") != sha256_file(artifact):
            raise SystemExit(
                "Draft changed after meaning review; reopen the task and "
                "repeat both reviews"
            )
        verdict = review_field(review.read_text(encoding="utf-8"), "Verdict")
        issue_note = review_note.strip()
        if allow_unresolved_final:
            if verdict != "FAIL":
                raise SystemExit(
                    "--allow-unresolved-final is only valid for Verdict: FAIL"
                )
            if int(row.get("revision", 0)) < 3:
                raise SystemExit(
                    "An unresolved task can be finalized only on revision 3 or later"
                )
            if not re.search(
                r"-r3-readability\.md$",
                review_path.replace("\\", "/"),
            ):
                raise SystemExit(
                    "An unresolved final task review must use an -r3-readability.md path"
                )
            if not issue_note:
                raise SystemExit(
                    "--review-note is required for an unresolved final task"
                )
        elif issue_note:
            raise SystemExit(
                "--review-note requires --allow-unresolved-final"
            )
        failures = review_errors(
            root,
            row,
            review,
            "readability",
            allow_fail=allow_unresolved_final,
        )
        if failures:
            raise SystemExit(
                "Readability review failed validation:\n- "
                + "\n- ".join(failures)
            )
        row["readability_review_path"] = review_path.replace("\\", "/")
        row["readability_review_sha256"] = sha256_file(review)
        row["readability_review_artifact_sha256"] = sha256_file(artifact)
        row["review_status"] = (
            "needs_review" if allow_unresolved_final else "passed"
        )
        if issue_note:
            row["review_note"] = issue_note
            row["review_attempt"] = 3
    if new_status == "approved":
        if not row.get("meaning_review_path") or not row.get(
            "readability_review_path"
        ):
            raise SystemExit("Both review paths are required before approval")
        current_hash = sha256_file(artifact)
        if row.get("meaning_review_artifact_sha256") != current_hash or row.get(
            "readability_review_artifact_sha256"
        ) != current_hash:
            raise SystemExit(
                "Both reviews must be bound to the current draft before approval"
            )
        for kind in ("meaning", "readability"):
            path_key = f"{kind}_review_path"
            hash_key = f"{kind}_review_sha256"
            saved_review = root / str(row[path_key])
            if not saved_review.is_file() or sha256_file(
                saved_review
            ) != row.get(hash_key):
                raise SystemExit(
                    f"{kind.capitalize()} review changed after validation"
                )
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


def task_reopen(root: Path, task_id: str) -> None:
    path = root / "manifests" / "tasks.jsonl"
    rows = read_jsonl(path)
    row = next((item for item in rows if item.get("task_id") == task_id), None)
    if row is None:
        raise SystemExit(f"Unknown task: {task_id}")
    old_status = str(row.get("status", ""))
    if old_status not in ("meaning_reviewed", "readability_reviewed"):
        raise SystemExit(
            "Only a task under review can be reopened; "
            f"{task_id} is {old_status}"
        )
    artifact = root / str(row["artifact_path"])
    if not artifact.is_file():
        raise SystemExit(f"Draft artifact does not exist: {artifact}")
    row["status"] = "drafted"
    row["artifact_sha256"] = sha256_file(artifact)
    row["meaning_review_path"] = ""
    row["readability_review_path"] = ""
    row["meaning_review_sha256"] = ""
    row["readability_review_sha256"] = ""
    row["meaning_review_artifact_sha256"] = ""
    row["readability_review_artifact_sha256"] = ""
    row["last_updated"] = now()
    write_jsonl(path, rows)
    append_event(
        root,
        chapter=str(row["chapter_id"]),
        task_id=task_id,
        stage="review-reopened",
        artifact=str(row.get("artifact_path", "")),
        result=f"{old_status}->drafted",
        next_stage="meaning_reviewed",
    )
    print(f"{task_id}: {old_status} -> drafted (reviews cleared)")


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
    if old_status not in ("readability_reviewed", "assembled"):
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
    work_units = read_jsonl(root / "manifests" / "work-units.jsonl")
    unit = next(
        (
            row
            for row in work_units
            if row.get("controller_chapter_id") == chapter_id
        ),
        None,
    )
    section_heading = ""
    if unit:
        sibling_count = sum(
            row.get("chapter_id") == unit.get("chapter_id")
            for row in work_units
        )
        if sibling_count > 1:
            numerals = ("", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十")
            number = int(unit.get("number", 0))
            number_label = numerals[number] if 0 < number < len(numerals) else str(number)
            section_heading = f"## {number_label}、{unit['title_zh']}\n\n"
    assembled = (
        f"# {chapter['title_zh']}\n\n"
        + section_heading
        + "\n\n".join(bodies)
        + "\n"
    )
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
        root / "manifests" / "unit-version-reviews.jsonl",
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
        if project.get("standard_version") != STANDARD_VERSION:
            errors.append(
                f"project standard_version is not {STANDARD_VERSION}"
            )
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
        version_rows = read_jsonl(
            root / "manifests" / "unit-versions.jsonl"
        )
        version_review_rows = read_jsonl(
            root / "manifests" / "unit-version-reviews.jsonl"
        )
        release_rows = read_jsonl(root / "manifests" / "releases.jsonl")
        source_rows = read_jsonl(root / "sources" / "source-manifest.jsonl")
        read_jsonl(root / "progress" / "events.jsonl")
    except (ValueError, OSError) as exc:
        errors.append(str(exc))
        (
            chapter_rows,
            task_rows,
            version_rows,
            version_review_rows,
            release_rows,
            source_rows,
        ) = ([], [], [], [], [], [])
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
    chapter_by_id = {
        str(row.get("chapter_id", "")): row for row in chapter_rows
    }
    parsed_source_by_chapter: dict[str, list[dict[str, str]]] = {}
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
        if (
            row.get("status") not in ("superseded", "approved")
            and row.get("spec_sha256") != current_spec_hash
        ):
            errors.append(f"{task_id}: task specification hash is stale")
        if row.get("status") != "superseded":
            chapter = chapter_by_id.get(chapter_id)
            if chapter is not None:
                try:
                    if chapter_id not in parsed_source_by_chapter:
                        parsed_source_by_chapter[chapter_id] = parse_source(
                            root / str(chapter["source_path"])
                        )
                    paragraphs = parsed_source_by_chapter[chapter_id]
                    paragraph_ids = [item["id"] for item in paragraphs]
                    start = paragraph_ids.index(str(row["start_paragraph"]))
                    end = paragraph_ids.index(str(row["end_paragraph"]))
                    current_source = source_blocks_with_referenced_notes(
                        root / str(chapter["source_path"]),
                        paragraphs[start : end + 1],
                    )
                    if sha256_text(current_source) != row.get("source_sha256"):
                        package_source = source_from_task_package(
                            root / str(row["task_package_path"])
                        )
                        if normalized_source_identity(
                            current_source
                        ) != normalized_source_identity(package_source):
                            errors.append(
                                f"{task_id}: task source is stale against current "
                                "chapter source (including referenced notes)"
                            )
                except (KeyError, ValueError) as exc:
                    errors.append(
                        f"{task_id}: cannot verify current source slice: {exc}"
                    )
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
        if row.get("status") != "superseded" and row.get("status") in (
            "meaning_reviewed",
            "readability_reviewed",
            "approved",
        ):
            meaning_path = root / str(row.get("meaning_review_path", ""))
            if not meaning_path.is_file():
                errors.append(f"{task_id}: missing meaning review")
            else:
                if sha256_file(meaning_path) != row.get(
                    "meaning_review_sha256"
                ):
                    errors.append(f"{task_id}: meaning review hash mismatch")
                for failure in review_errors(
                    root, row, meaning_path, "meaning"
                ):
                    errors.append(f"{task_id}: meaning review: {failure}")
        if row.get("status") != "superseded" and row.get("status") in (
            "readability_reviewed",
            "approved",
        ):
            readability_path = root / str(
                row.get("readability_review_path", "")
            )
            if not readability_path.is_file():
                errors.append(f"{task_id}: missing readability review")
            else:
                if sha256_file(readability_path) != row.get(
                    "readability_review_sha256"
                ):
                    errors.append(
                        f"{task_id}: readability review hash mismatch"
                    )
                allow_fail = row.get("review_status") == "needs_review"
                if allow_fail and not str(row.get("review_note", "")).strip():
                    errors.append(
                        f"{task_id}: unresolved final task lacks review_note"
                    )
                for failure in review_errors(
                    root,
                    row,
                    readability_path,
                    "readability",
                    allow_fail=allow_fail,
                ):
                    errors.append(
                        f"{task_id}: readability review: {failure}"
                    )
        if row.get("status") != "superseded" and row.get(
            "status"
        ) == "approved":
            approved_artifact = root / str(row["artifact_path"])
            if approved_artifact.is_file():
                current_artifact_hash = sha256_file(approved_artifact)
                if row.get(
                    "meaning_review_artifact_sha256"
                ) != current_artifact_hash or row.get(
                    "readability_review_artifact_sha256"
                ) != current_artifact_hash:
                    errors.append(
                        f"{task_id}: reviews are not bound to current draft"
                    )
    for chapter_id, ranges in active_ranges.items():
        ranges.sort()
        for previous, current in zip(ranges, ranges[1:]):
            if current[0] <= previous[1]:
                errors.append(
                    f"{chapter_id}: overlapping tasks {previous[2]} and {current[2]}"
                )
        chapter = next(
            (
                item
                for item in chapter_rows
                if str(item.get("chapter_id", "")) == chapter_id
            ),
            None,
        )
        if chapter is None:
            continue
        source_path = root / str(chapter.get("source_path", ""))
        if not source_path.is_file():
            continue
        try:
            expected_numbers = [
                paragraph_number(str(item["id"]))
                for item in parse_source(source_path)
            ]
        except (KeyError, ValueError, OSError) as exc:
            errors.append(
                f"{chapter_id}: cannot verify task coverage: {exc}"
            )
            continue
        covered_numbers: list[int] = []
        for start, end, _task_id in ranges:
            if start > end:
                errors.append(
                    f"{chapter_id}: task range starts after it ends"
                )
                continue
            covered_numbers.extend(range(start, end + 1))
        if covered_numbers != expected_numbers:
            missing = sorted(set(expected_numbers) - set(covered_numbers))
            extra = sorted(set(covered_numbers) - set(expected_numbers))
            details: list[str] = []
            if missing:
                details.append(
                    "missing " + ", ".join(f"p{number:04d}" for number in missing)
                )
            if extra:
                details.append(
                    "extra " + ", ".join(f"p{number:04d}" for number in extra)
                )
            if not details:
                details.append("ranges are out of source order")
            errors.append(
                f"{chapter_id}: active tasks do not cover source paragraphs "
                f"exactly once ({'; '.join(details)})"
            )
    version_by_id = {
        str(row.get("version_id", "")): row for row in version_rows
    }
    for row in version_review_rows:
        review_id = str(row.get("review_id", ""))
        review_path = root / str(row.get("review_path", ""))
        if not review_id:
            errors.append("unit-version review has no review_id")
        if not review_path.is_file():
            errors.append(f"{review_id}: missing review file")
            continue
        if row.get("review_sha256") and sha256_file(
            review_path
        ) != row.get("review_sha256"):
            errors.append(f"{review_id}: review hash mismatch")
        version_id = str(row.get("version_id", ""))
        version = version_by_id.get(version_id)
        if version:
            artifact = root / str(version.get("artifact_path", ""))
            if artifact.is_file() and sha256_file(artifact) != row.get(
                "artifact_sha256"
            ):
                errors.append(
                    f"{review_id}: artifact hash does not match version"
                )
    for row in version_rows:
        if row.get("standard_version") != STANDARD_VERSION:
            continue
        version_id = str(row.get("version_id", ""))
        review_path = root / str(row.get("reader_review_path", ""))
        if not review_path.is_file():
            errors.append(f"{version_id}: missing independent reader review")
            continue
        if sha256_file(review_path) != row.get("reader_review_sha256"):
            errors.append(f"{version_id}: independent review hash mismatch")
        artifact = root / str(row.get("artifact_path", ""))
        if artifact.is_file():
            review_text = review_path.read_text(encoding="utf-8")
            verdict = review_field(review_text, "Verdict")
            review_status = str(row.get("review_status", ""))
            allow_fail = review_status == "needs_review"
            for failure in independent_review_errors(
                str(row.get("unit_id", "")),
                artifact.read_text(encoding="utf-8"),
                review_path,
                allow_fail=allow_fail,
            ):
                errors.append(
                    f"{version_id}: independent review: {failure}"
                )
            if row.get("reader_review_verdict") != verdict:
                errors.append(
                    f"{version_id}: stored reader verdict does not match review"
                )
            if verdict == "PASS":
                if review_status != "passed":
                    errors.append(
                        f"{version_id}: PASS version must have review_status passed"
                    )
                if str(row.get("review_note", "")).strip():
                    errors.append(
                        f"{version_id}: PASS version must not have review_note"
                    )
            elif verdict == "FAIL":
                if review_status != "needs_review":
                    errors.append(
                        f"{version_id}: FAIL version must be needs_review"
                    )
                if not str(row.get("review_note", "")).strip():
                    errors.append(
                        f"{version_id}: needs_review version lacks review_note"
                    )
                if not re.search(
                    r"-independent(?:-reader)?-r3\.md$",
                    str(row.get("reader_review_path", "")),
                ):
                    errors.append(
                        f"{version_id}: unresolved review must be final attempt r3"
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
    work_units = read_jsonl(root / "manifests" / "work-units.jsonl")
    versions = read_jsonl(root / "manifests" / "unit-versions.jsonl")
    version_reviews = read_jsonl(
        root / "manifests" / "unit-version-reviews.jsonl"
    )
    adoptions_path = root / "manifests" / "adoptions.json"
    adoptions = read_json(adoptions_path) if adoptions_path.is_file() else {}
    events = read_jsonl(root / "progress" / "events.jsonl")[-20:]
    if chapter_id:
        selected_units = [
            row
            for row in work_units
            if row.get("chapter_id") == chapter_id
            or row.get("controller_chapter_id") == chapter_id
            or row.get("unit_id") == chapter_id
        ]
        controller_ids = {
            str(row.get("controller_chapter_id", ""))
            for row in selected_units
        }
        controller_ids.add(chapter_id)
        selected_unit_ids = {
            str(row.get("unit_id", "")) for row in selected_units
        }
        chapters = [
            row
            for row in chapters
            if row.get("chapter_id") in controller_ids
        ]
        tasks = [
            row for row in tasks if row.get("chapter_id") in controller_ids
        ]
        work_units = selected_units
        versions = [
            row
            for row in versions
            if row.get("unit_id") in selected_unit_ids
        ]
        version_reviews = [
            row
            for row in version_reviews
            if row.get("unit_id") in selected_unit_ids
        ]
        adoptions = {
            key: value
            for key, value in adoptions.items()
            if key in selected_unit_ids
        }
        events = [
            row
            for row in events
            if row.get("chapter") in ("", chapter_id)
            or row.get("chapter") in controller_ids
        ]
    pending = [
        row
        for row in tasks
        if row.get("status") not in ("approved", "superseded")
    ]
    next_actions: list[dict[str, Any]] = []
    if pending:
        first = pending[0]
        next_actions.append(
            {
                "action": "resume-task",
                "task_id": first.get("task_id"),
                "task_package_path": first.get("task_package_path"),
                "status": first.get("status"),
            }
        )
    else:
        active_task_chapters = {
            str(row.get("chapter_id", ""))
            for row in tasks
            if row.get("status") != "superseded"
        }
        snapshot = str(project.get("skill_snapshot", ""))
        controller_path = (
            root / snapshot / "scripts" / "reader_project_controller.py"
        )
        for chapter in chapters:
            controller_id = str(chapter.get("chapter_id", ""))
            if (
                chapter.get("status") == "source_locked"
                and controller_id not in active_task_chapters
            ):
                next_actions.append(
                    {
                        "action": "make-tasks",
                        "chapter_id": controller_id,
                        "command_args": [
                            sys.executable,
                            str(controller_path),
                            "make-tasks",
                            str(root),
                            controller_id,
                            "--max-paragraphs",
                            "5",
                        ],
                    }
                )
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
                "work_units": work_units,
                "versions": versions,
                "version_reviews": version_reviews,
                "adoptions": adoptions,
                "next_tasks": pending[:5],
                "next_actions": next_actions,
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


def find_work_unit(root: Path, unit_id: str) -> dict[str, Any]:
    units = read_jsonl(root / "manifests" / "work-units.jsonl")
    unit = next((row for row in units if row.get("unit_id") == unit_id), None)
    if unit is None:
        raise SystemExit(f"Unknown work unit: {unit_id}")
    return unit


def adopt_version(root: Path, unit_id: str, version_id: str) -> None:
    find_work_unit(root, unit_id)
    versions = read_jsonl(root / "manifests" / "unit-versions.jsonl")
    selected = next(
        (
            row
            for row in versions
            if row.get("unit_id") == unit_id
            and row.get("version_id") == version_id
        ),
        None,
    )
    if selected is None:
        raise SystemExit(
            f"Version {version_id} does not belong to work unit {unit_id}"
        )
    if selected.get("review_status") == "needs_review":
        raise SystemExit(
            f"Version {version_id} still needs reader review and cannot be adopted"
        )
    adoptions_path = root / "manifests" / "adoptions.json"
    adoptions = read_json(adoptions_path) if adoptions_path.is_file() else {}
    if not isinstance(adoptions, dict):
        raise SystemExit("manifests/adoptions.json must contain an object")
    adoptions[unit_id] = version_id
    write_json(adoptions_path, adoptions)
    append_event(
        root,
        chapter=str(find_work_unit(root, unit_id).get("chapter_id", "")),
        stage="version-adopted",
        artifact=str(selected.get("artifact_path", "")),
        result=version_id,
        next_stage="rebuild-chapter",
    )
    print(f"{unit_id}: adopted {version_id}")


def register_version(
    root: Path,
    unit_id: str,
    summary: str,
    source_path: str | None,
    reader_review_path: str | None,
    adopt: bool,
    allow_unresolved_final: bool,
    review_note: str,
) -> None:
    unit = find_work_unit(root, unit_id)
    controller_id = str(unit.get("controller_chapter_id", ""))
    chapters = read_jsonl(root / "manifests" / "chapters.jsonl")
    controller = next(
        (row for row in chapters if row.get("chapter_id") == controller_id),
        None,
    )
    if controller is None:
        raise SystemExit(
            f"Work unit {unit_id} has unknown controller chapter {controller_id}"
        )
    tasks = sorted(
        (
            row
            for row in read_jsonl(root / "manifests" / "tasks.jsonl")
            if row.get("chapter_id") == controller_id
            and row.get("status") != "superseded"
        ),
        key=lambda row: paragraph_number(str(row["start_paragraph"])),
    )
    if not tasks or any(row.get("status") != "approved" for row in tasks):
        raise SystemExit(
            "Version registration requires every active task to be approved"
        )
    source = root / str(source_path or controller.get("output_path", ""))
    if not source.is_file():
        raise SystemExit(f"Missing assembled version source: {source}")
    relative(root, source)
    body = source.read_text(encoding="utf-8").strip()
    if not body:
        raise SystemExit("Cannot register an empty version")
    if INTERNAL_MARKERS.search(body):
        raise SystemExit("Reader version contains an internal task marker")
    version_text = body + "\n"
    if not reader_review_path:
        raise SystemExit(
            "--reader-review-path is required for version registration"
        )
    reader_review = root / reader_review_path
    if not reader_review.is_file():
        raise SystemExit(
            f"Independent reader review does not exist: {reader_review}"
        )
    review_text = reader_review.read_text(encoding="utf-8")
    verdict = review_field(review_text, "Verdict")
    failures = independent_review_errors(
        unit_id,
        version_text,
        reader_review,
        allow_fail=allow_unresolved_final,
    )
    if failures:
        raise SystemExit(
            "Independent reader review failed validation:\n- "
            + "\n- ".join(failures)
        )
    issue_note = review_note.strip()
    if verdict == "FAIL":
        if not allow_unresolved_final:
            raise SystemExit(
                "A final FAIL requires --allow-unresolved-final"
            )
        if not re.search(
            r"-independent(?:-reader)?-r3\.md$",
            reader_review_path.replace("\\", "/"),
        ):
            raise SystemExit(
                "An unresolved final review must use an -independent-r3.md path"
            )
        if not issue_note:
            raise SystemExit(
                "--review-note is required for an unresolved final review"
            )
        if adopt:
            raise SystemExit(
                "A needs_review version cannot be auto-adopted"
            )
        review_status = "needs_review"
    else:
        if allow_unresolved_final:
            raise SystemExit(
                "--allow-unresolved-final is only valid for Verdict: FAIL"
            )
        if issue_note:
            raise SystemExit(
                "A passing version must not include --review-note"
            )
        review_status = "passed"
    versions_path = root / "manifests" / "unit-versions.jsonl"
    versions = read_jsonl(versions_path)
    existing = [row for row in versions if row.get("unit_id") == unit_id]
    number = max((int(row.get("number", 0)) for row in existing), default=0) + 1
    version_id = f"{unit_id}-v{number}"
    if any(row.get("version_id") == version_id for row in versions):
        raise SystemExit(f"Version already exists: {version_id}")
    artifact = root / "reader-edition" / "versions" / f"{version_id}.md"
    if artifact.exists():
        raise SystemExit(f"Version artifact already exists: {artifact}")
    atomic_write_text(artifact, version_text)
    row = {
        "version_id": version_id,
        "unit_id": unit_id,
        "number": number,
        "artifact_path": relative(root, artifact),
        "created_at": now(),
        "source_task_revisions": [str(task["task_id"]) for task in tasks],
        "standard_version": STANDARD_VERSION,
        "reader_review_path": reader_review_path.replace("\\", "/"),
        "reader_review_sha256": sha256_file(reader_review),
        "reader_review_verdict": verdict,
        "review_status": review_status,
        "summary": summary,
    }
    if issue_note:
        row["review_note"] = issue_note
    append_jsonl(versions_path, row)
    append_jsonl(
        root / "manifests" / "unit-version-reviews.jsonl",
        {
            "review_id": f"{version_id}-independent-r1",
            "unit_id": unit_id,
            "version_id": version_id,
            "review_type": "independent-reader",
            "artifact_sha256": sha256_text(version_text),
            "review_path": reader_review_path.replace("\\", "/"),
            "review_sha256": sha256_file(reader_review),
            "reviewer_context": review_field(review_text, "Reviewer-Context"),
            "source_access": False,
            "verdict": verdict,
            "review_attempt": 3 if verdict == "FAIL" else 1,
            **({"review_note": issue_note} if issue_note else {}),
            "created_at": now(),
        },
    )
    append_event(
        root,
        chapter=str(unit.get("chapter_id", "")),
        stage="version-registered",
        artifact=str(row["artifact_path"]),
        result=(
            "completed:needs_review"
            if review_status == "needs_review"
            else "completed:candidate"
        ),
        next_stage=(
            "later-reader-review"
            if review_status == "needs_review"
            else "adoption"
        ),
    )
    if adopt:
        adopt_version(root, unit_id, version_id)
    print(json.dumps(row, ensure_ascii=False, indent=2))


def rebuild_chapter(root: Path, chapter_id: str) -> None:
    units = sorted(
        (
            row
            for row in read_jsonl(root / "manifests" / "work-units.jsonl")
            if row.get("chapter_id") == chapter_id
        ),
        key=lambda row: int(row.get("number", 0)),
    )
    if not units:
        raise SystemExit(f"No work units recorded for logical chapter {chapter_id}")
    chapters = read_jsonl(root / "manifests" / "chapters.jsonl")
    chapter = next(
        (row for row in chapters if row.get("chapter_id") == chapter_id), None
    )
    if chapter is None:
        raise SystemExit(f"Missing primary chapter row: {chapter_id}")
    versions = {
        str(row.get("version_id")): row
        for row in read_jsonl(root / "manifests" / "unit-versions.jsonl")
    }
    adoptions_path = root / "manifests" / "adoptions.json"
    adoptions = read_json(adoptions_path) if adoptions_path.is_file() else {}
    if not isinstance(adoptions, dict):
        raise SystemExit("manifests/adoptions.json must contain an object")
    bodies: list[str] = []
    for unit in units:
        unit_id = str(unit.get("unit_id", ""))
        version_id = str(adoptions.get(unit_id, ""))
        version = versions.get(version_id)
        if not version or version.get("unit_id") != unit_id:
            raise SystemExit(f"Work unit has no valid adopted version: {unit_id}")
        artifact = root / str(version.get("artifact_path", ""))
        if not artifact.is_file():
            raise SystemExit(f"Missing adopted version artifact: {artifact}")
        body = artifact.read_text(encoding="utf-8").strip()
        body = re.sub(r"\A\s*#\s+[^\n]+\n+", "", body).strip()
        bodies.append(body)
    output = root / str(chapter.get("output_path", ""))
    assembled = (
        f"# {chapter['title_zh']}\n\n"
        + "\n\n".join(bodies)
        + "\n"
    )
    atomic_write_text(output, assembled)
    append_event(
        root,
        chapter=chapter_id,
        stage="chapter-rebuilt-from-adoptions",
        artifact=relative(root, output),
        result="completed",
        next_stage="reader-review",
    )
    print(f"Rebuilt {output} ({sha256_file(output)})")


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
    task_parser.add_argument(
        "--replace-incomplete",
        action="store_true",
        help=(
            "supersede pending, in-progress, or unreviewed drafted tasks and "
            "rechunk the current verified source"
        ),
    )
    refresh_parser = subparsers.add_parser("refresh-tasks")
    refresh_parser.add_argument("project_root", type=Path)
    refresh_parser.add_argument("chapter")
    refresh_parser.add_argument(
        "--task-id",
        action="append",
        dest="task_ids",
        help=(
            "refresh only this pending, in-progress, or unreviewed drafted task; "
            "repeat for multiple tasks"
        ),
    )
    revise_parser = subparsers.add_parser("revise-tasks")
    revise_parser.add_argument("project_root", type=Path)
    revise_parser.add_argument("chapter")
    revise_parser.add_argument(
        "--allow-incomplete",
        action="store_true",
        help="supersede incomplete active tasks during an explicit specification reset",
    )
    revise_parser.add_argument(
        "--task-id",
        action="append",
        dest="task_ids",
        help="revise only this active task; repeat for multiple tasks",
    )
    update_parser = subparsers.add_parser("task-update")
    update_parser.add_argument("project_root", type=Path)
    update_parser.add_argument("task_id")
    update_parser.add_argument("--status", required=True)
    update_parser.add_argument("--artifact-path")
    update_parser.add_argument("--review-path")
    update_parser.add_argument("--allow-unresolved-final", action="store_true")
    update_parser.add_argument("--review-note", default="")
    reopen_parser = subparsers.add_parser("task-reopen")
    reopen_parser.add_argument("project_root", type=Path)
    reopen_parser.add_argument("task_id")
    chapter_parser = subparsers.add_parser("chapter-advance")
    chapter_parser.add_argument("project_root", type=Path)
    chapter_parser.add_argument("chapter")
    chapter_parser.add_argument("--status", required=True)
    assemble_parser = subparsers.add_parser("assemble")
    assemble_parser.add_argument("project_root", type=Path)
    assemble_parser.add_argument("chapter")
    register_parser = subparsers.add_parser("register-version")
    register_parser.add_argument("project_root", type=Path)
    register_parser.add_argument("unit_id")
    register_parser.add_argument("--summary", default="")
    register_parser.add_argument("--source-path")
    register_parser.add_argument("--reader-review-path")
    register_parser.add_argument("--allow-unresolved-final", action="store_true")
    register_parser.add_argument("--review-note", default="")
    register_parser.add_argument("--adopt", action="store_true")
    adopt_parser = subparsers.add_parser("adopt-version")
    adopt_parser.add_argument("project_root", type=Path)
    adopt_parser.add_argument("unit_id")
    adopt_parser.add_argument("version_id")
    rebuild_parser = subparsers.add_parser("rebuild-chapter")
    rebuild_parser.add_argument("project_root", type=Path)
    rebuild_parser.add_argument("chapter")
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
        make_tasks(
            root,
            args.chapter,
            args.max_paragraphs,
            args.title,
            args.replace_incomplete,
        )
    elif args.command == "refresh-tasks":
        refresh_tasks(root, args.chapter, args.task_ids)
    elif args.command == "revise-tasks":
        revise_tasks(
            root,
            args.chapter,
            args.allow_incomplete,
            args.task_ids,
        )
    elif args.command == "task-update":
        task_update(
            root,
            args.task_id,
            args.status,
            args.artifact_path,
            args.review_path,
            args.allow_unresolved_final,
            args.review_note,
        )
    elif args.command == "task-reopen":
        task_reopen(root, args.task_id)
    elif args.command == "chapter-advance":
        chapter_advance(root, args.chapter, args.status)
    elif args.command == "assemble":
        assemble(root, args.chapter)
    elif args.command == "register-version":
        register_version(
            root,
            args.unit_id,
            args.summary,
            args.source_path,
            args.reader_review_path,
            args.adopt,
            args.allow_unresolved_final,
            args.review_note,
        )
    elif args.command == "adopt-version":
        adopt_version(root, args.unit_id, args.version_id)
    elif args.command == "rebuild-chapter":
        rebuild_chapter(root, args.chapter)
    else:
        raise AssertionError(args.command)
    return 0


if __name__ == "__main__":
    sys.exit(main())
