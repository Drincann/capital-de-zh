#!/usr/bin/env python3
"""Initialize a durable plain-Chinese Capital reader's-edition project."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from reader_project_controller import migrate


SOURCES = [
    {
        "source_id": "de-1890",
        "role": "base",
        "language": "de",
        "edition": "German fourth edition, Hamburg",
        "year": "1890",
        "authority": "MEGA II/10",
        "item_url": "https://telota.bbaw.de/mega/",
        "text_url": "https://telota.bbaw.de/mega/docs/MEGA_A2_B010-00_ETX.xml",
        "facsimile_url": "https://archive.org/details/daskapital04unkngoog",
    },
    {
        "source_id": "fr-1872-1875",
        "role": "author-revised-witness",
        "language": "fr",
        "edition": "French edition revised by Marx, Paris",
        "year": "1872-1875",
        "authority": "MEGA II/7",
        "item_url": "https://fr.wikisource.org/wiki/Le_Capital",
        "text_url": "https://fr.wikisource.org/wiki/Le_Capital/Texte_entier",
        "facsimile_url": "https://archive.org/details/ldpd_13051551_000",
    },
    {
        "source_id": "de-1872",
        "role": "principal-authorial-witness",
        "language": "de",
        "edition": "German second edition, Hamburg",
        "year": "1872",
        "authority": "MEGA II/6",
        "item_url": "https://archive.org/details/bub_gb_xCMpAAAAYAAJ",
        "text_url": (
            "https://archive.org/download/bub_gb_xCMpAAAAYAAJ/"
            "bub_gb_xCMpAAAAYAAJ_djvu.txt"
        ),
        "facsimile_url": (
            "https://archive.org/download/bub_gb_xCMpAAAAYAAJ/"
            "bub_gb_xCMpAAAAYAAJ.pdf"
        ),
    },
    {
        "source_id": "de-1867",
        "role": "historical-witness",
        "language": "de",
        "edition": "German first edition, Hamburg",
        "year": "1867",
        "authority": "MEGA II/5",
        "item_url": "https://archive.org/details/daskapitalkritik67marx",
        "text_url": "https://telota.bbaw.de/mega/docs/MEGA_A2_B005-00_ETX.xml",
        "facsimile_url": "https://archive.org/details/daskapitalkritik67marx",
    },
]


def write_json(path: Path, value: object) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("project_root", type=Path)
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--scope", default="《资本论》第一卷")
    args = parser.parse_args()

    root = args.project_root.resolve()
    if root.exists() and any(root.iterdir()):
        raise SystemExit(f"Refusing to initialize non-empty directory: {root}")
    root.mkdir(parents=True, exist_ok=True)
    for directory in (
        root / "sources" / "raw",
        root / "sources" / "facsimiles",
        root / "sources" / "normalized",
        root / "chapters",
        root / "decisions",
        root / "progress",
    ):
        directory.mkdir(parents=True, exist_ok=True)

    created = datetime.now(timezone.utc).isoformat()
    write_json(
        root / "project.json",
        {
            "project_id": args.project_id,
            "title": args.title,
            "scope": args.scope,
            "status": "source-acquisition",
            "base_edition": "de-1890",
            "witnesses": ["fr-1872-1875", "de-1872", "de-1867"],
            "translation_standard": "translate-capital-de-zh",
            "created_at": created,
            "last_updated": created,
        },
    )
    (root / "PROJECT.md").write_text(
        f"# {args.title}\n\n正在初始化读者版项目。\n",
        encoding="utf-8",
        newline="\n",
    )
    with (root / "sources" / "source-manifest.jsonl").open(
        "w", encoding="utf-8", newline="\n"
    ) as handle:
        for source in SOURCES:
            handle.write(
                json.dumps(
                    {
                        **source,
                        "local_path": "",
                        "sha256": "",
                        "bytes": 0,
                        "status": "candidate",
                        "verified": False,
                        "notes": "",
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    (root / "decisions" / "translation-decisions.jsonl").write_text(
        "", encoding="utf-8"
    )
    (root / "decisions" / "terminology.tsv").write_text(
        "source_term\tmeaning_or_contrast\tchosen_zh\trejected\tstatus\tdecision_id\n",
        encoding="utf-8",
    )
    (root / "progress" / "events.jsonl").write_text(
        json.dumps(
            {
                "time": created,
                "chapter": "",
                "task_id": "",
                "stage": "project-init",
                "artifact": "project.json",
                "result": "completed",
                "next": "source-acquisition",
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    migrate(root)
    print(root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
