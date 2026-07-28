#!/usr/bin/env python3
"""Initialize a durable Capital translation project."""

from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path


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
        "text_url": "https://archive.org/download/bub_gb_xCMpAAAAYAAJ/bub_gb_xCMpAAAAYAAJ_djvu.txt",
        "facsimile_url": "https://archive.org/download/bub_gb_xCMpAAAAYAAJ/bub_gb_xCMpAAAAYAAJ.pdf",
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
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("project_root", type=Path)
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--scope", default="Capital, Volume I")
    parser.add_argument(
        "--skill-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
    )
    args = parser.parse_args()

    root = args.project_root.resolve()
    if root.exists() and any(root.iterdir()):
        raise SystemExit(f"Refusing to initialize non-empty directory: {root}")

    for directory in (
        root / "sources" / "raw",
        root / "sources" / "facsimiles",
        root / "sources" / "normalized",
        root / "chapters",
        root / "decisions",
        root / "progress",
        root / "skill-snapshot",
    ):
        directory.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc).isoformat()
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
            "created_at": now,
            "last_updated": now,
        },
    )

    project_md = f"""# {args.title}

本项目是从德文原典开始的全新现代汉语翻译，不以任何既有中译本为底稿。

底本：MEGAdigital提供的1890年德文第四版校勘文本（MEGA II/10）。

参校：马克思亲自修订的1872—1875年法文版（MEGA II/7）；涉及重要版本
差异时，核对1872年德文第二版原书（MEGA II/6），并查阅MEGAdigital
提供的1867年德文第一版校勘文本（MEGA II/5）。

当前阶段：来源获取与版本核验。
"""
    (root / "PROJECT.md").write_text(project_md, encoding="utf-8")

    with (root / "sources" / "source-manifest.jsonl").open(
        "w", encoding="utf-8", newline="\n"
    ) as handle:
        for source in SOURCES:
            row = {
                **source,
                "local_path": "",
                "sha256": "",
                "bytes": 0,
                "status": "candidate",
                "verified": False,
                "notes": "",
            }
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    (root / "decisions" / "translation-decisions.jsonl").write_text(
        "", encoding="utf-8"
    )
    (root / "decisions" / "terminology.tsv").write_text(
        "source_term\tmeaning_or_contrast\tchosen_zh\trejected\tstatus\tdecision_id\n",
        encoding="utf-8",
    )
    with (root / "progress" / "events.jsonl").open(
        "w", encoding="utf-8", newline="\n"
    ) as handle:
        handle.write(
            json.dumps(
                {
                    "time": now,
                    "chapter": "",
                    "stage": "project-init",
                    "through": "",
                    "artifact": "project.json",
                    "result": "completed",
                    "next": "source-acquisition",
                },
                ensure_ascii=False,
            )
            + "\n"
        )

    skill_root = args.skill_root.resolve()
    if not (skill_root / "SKILL.md").exists():
        raise SystemExit(f"Skill root has no SKILL.md: {skill_root}")
    shutil.copytree(skill_root, root / "skill-snapshot", dirs_exist_ok=True)
    print(root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
