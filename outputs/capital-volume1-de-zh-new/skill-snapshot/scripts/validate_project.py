#!/usr/bin/env python3
"""Validate durable state for a Capital translation project."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


REQUIRED_SOURCE_IDS = {
    "de-1872",
    "fr-1872-1875",
    "de-1890",
    "de-1867",
}
VALID_STATUSES = {
    "candidate",
    "downloaded-unverified",
    "search-aid-only",
    "edition-verified",
    "passage-verified",
    "rejected",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_jsonl(path: Path, errors: list[str]) -> list[dict]:
    rows = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as exc:
            errors.append(f"{path}:{number}: invalid JSON: {exc}")
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("project_root", type=Path)
    args = parser.parse_args()
    root = args.project_root.resolve()
    errors: list[str] = []

    required = [
        root / "project.json",
        root / "PROJECT.md",
        root / "sources" / "source-manifest.jsonl",
        root / "decisions" / "translation-decisions.jsonl",
        root / "decisions" / "terminology.tsv",
        root / "progress" / "events.jsonl",
        root / "skill-snapshot" / "SKILL.md",
    ]
    for path in required:
        if not path.exists():
            errors.append(f"missing: {path}")
    if errors:
        print("\n".join(errors))
        return 1

    try:
        project = json.loads((root / "project.json").read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        errors.append(f"invalid project.json: {exc}")
        project = {}
    for key in (
        "project_id",
        "title",
        "scope",
        "status",
        "base_edition",
        "witnesses",
        "translation_standard",
    ):
        if not project.get(key):
            errors.append(f"project.json missing value: {key}")

    manifest = root / "sources" / "source-manifest.jsonl"
    rows = load_jsonl(manifest, errors)
    ids = [row.get("source_id") for row in rows]
    if set(ids) != REQUIRED_SOURCE_IDS or len(ids) != len(REQUIRED_SOURCE_IDS):
        errors.append(f"unexpected source IDs: {ids}")
    for row in rows:
        source_id = row.get("source_id", "<unknown>")
        if row.get("status") not in VALID_STATUSES:
            errors.append(f"{source_id}: invalid status {row.get('status')}")
        local_path = row.get("local_path")
        if not local_path:
            continue
        path = Path(local_path)
        if not path.is_absolute():
            path = root / path
        if not path.is_file():
            errors.append(f"{source_id}: local file missing: {path}")
            continue
        if path.stat().st_size != row.get("bytes"):
            errors.append(f"{source_id}: byte length mismatch")
        if sha256(path) != row.get("sha256"):
            errors.append(f"{source_id}: SHA-256 mismatch")

    progress = load_jsonl(root / "progress" / "events.jsonl", errors)
    if not progress:
        errors.append("progress/events.jsonl has no events")

    if errors:
        print("\n".join(errors))
        return 1
    downloaded = sum(bool(row.get("local_path")) for row in rows)
    print(f"OK: {project.get('project_id')} | sources {downloaded}/{len(rows)} downloaded")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
