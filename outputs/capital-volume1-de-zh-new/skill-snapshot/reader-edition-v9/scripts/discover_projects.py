#!/usr/bin/env python3
"""Discover durable Capital translation projects below a workspace root."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


IGNORED_PARTS = {
    ".git",
    ".idea",
    ".vscode",
    "__pycache__",
    "build",
    "dist",
    "node_modules",
}


def project_record(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(value, dict):
        return None
    if (
        value.get("translation_standard") != "translate-capital-de-zh"
        and value.get("project_type") != "plain-language-reader-edition"
    ):
        return None
    return {
        "project_root": str(path.parent.resolve()),
        "project_id": value.get("project_id", ""),
        "title": value.get("title", ""),
        "scope": value.get("scope", ""),
        "status": value.get("status", ""),
        "standard_version": value.get("standard_version", ""),
        "last_updated": value.get("last_updated", ""),
    }


def discover(search_root: Path) -> list[dict[str, Any]]:
    root = search_root.resolve()
    candidates: list[Path] = []
    direct = root / "project.json"
    if direct.is_file():
        candidates.append(direct)
    for path in root.rglob("project.json"):
        if path == direct:
            continue
        try:
            relative_parts = path.relative_to(root).parts
        except ValueError:
            continue
        if any(part in IGNORED_PARTS for part in relative_parts):
            continue
        candidates.append(path)
    return [
        record
        for path in sorted(set(candidates))
        if (record := project_record(path)) is not None
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("search_root", nargs="?", type=Path, default=Path.cwd())
    parser.add_argument(
        "--require-one",
        action="store_true",
        help="Fail unless exactly one matching project is found.",
    )
    args = parser.parse_args()
    projects = discover(args.search_root)
    print(json.dumps(projects, ensure_ascii=False, indent=2))
    if args.require_one and len(projects) != 1:
        print(
            f"Expected exactly one matching project; found {len(projects)}.",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
