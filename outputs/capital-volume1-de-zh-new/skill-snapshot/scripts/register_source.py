#!/usr/bin/env python3
"""Register a downloaded source file and its SHA-256 checksum."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("project_root", type=Path)
    parser.add_argument("source_id")
    parser.add_argument("local_file", type=Path)
    parser.add_argument("--status", default="downloaded-unverified")
    parser.add_argument("--notes", default=None)
    args = parser.parse_args()

    root = args.project_root.resolve()
    source_file = args.local_file.resolve()
    manifest = root / "sources" / "source-manifest.jsonl"
    if not source_file.is_file():
        raise SystemExit(f"Source file not found: {source_file}")
    rows = [
        json.loads(line)
        for line in manifest.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    matches = [row for row in rows if row["source_id"] == args.source_id]
    if len(matches) != 1:
        raise SystemExit(f"Expected one manifest row for {args.source_id}")

    try:
        local_path = source_file.relative_to(root).as_posix()
    except ValueError:
        local_path = str(source_file)

    for row in rows:
        if row["source_id"] == args.source_id:
            row["local_path"] = local_path
            row["sha256"] = sha256(source_file)
            row["bytes"] = source_file.stat().st_size
            row["status"] = args.status
            row["verified"] = args.status in {"edition-verified", "passage-verified"}
            if args.notes is not None:
                row["notes"] = args.notes

    with manifest.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    updated = next(row for row in rows if row["source_id"] == args.source_id)
    print(f"{args.source_id}\t{local_path}\t{updated['sha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
