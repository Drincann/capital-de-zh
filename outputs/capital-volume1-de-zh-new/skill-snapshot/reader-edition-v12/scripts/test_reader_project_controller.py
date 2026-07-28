#!/usr/bin/env python3
"""End-to-end smoke test for the durable reader-edition controller."""

from __future__ import annotations

import json
import tempfile
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

from reader_project_controller import (
    assemble,
    chapter_advance,
    context,
    make_tasks,
    migrate,
    read_jsonl,
    rebuild_chapter,
    refresh_tasks,
    register_version,
    revise_tasks,
    sha256_file,
    task_update,
    validate,
)


def main() -> int:
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        for directory in (
            root / "sources",
            root / "decisions",
            root / "progress",
            root / "chapters" / "ch05" / "source",
        ):
            directory.mkdir(parents=True, exist_ok=True)
        (root / "project.json").write_text(
            json.dumps(
                {
                    "project_id": "test-reader-edition",
                    "title": "测试项目",
                    "scope": "测试",
                    "status": "source-acquisition",
                    "base_edition": "de-1890",
                    "witnesses": ["fr-1872-1875"],
                    "translation_standard": "translate-capital-de-zh",
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "last_updated": "2026-01-01T00:00:00+00:00",
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        (root / "PROJECT.md").write_text("# 测试\n", encoding="utf-8")
        (root / "decisions" / "translation-decisions.jsonl").write_text(
            "", encoding="utf-8"
        )
        (root / "decisions" / "terminology.tsv").write_text(
            "source_term\tmeaning_or_contrast\tchosen_zh\trejected\tstatus\tdecision_id\n",
            encoding="utf-8",
        )
        (root / "progress" / "events.jsonl").write_text("", encoding="utf-8")
        (root / "chapters" / "ch05" / "source" / "de-1890.txt").write_text(
            """# 1) Arbeitsproceß.

[v1-ch05-s01-p0001] [MEGA p.161]
Der Gebrauch der Arbeitskraft ist die Arbeit selbst.

[v1-ch05-s01-p0002] [MEGA p.162]
Die Arbeit ist zunächst ein Proceß zwischen Mensch und Natur.

## Footnotes

[note-001]
Test.
""",
            encoding="utf-8",
        )
        source_path = root / "chapters" / "ch05" / "source" / "de-1890.txt"
        (root / "sources" / "source-manifest.jsonl").write_text(
            json.dumps(
                {
                    "source_id": "de-1890",
                    "role": "base",
                    "language": "de",
                    "edition": "test",
                    "year": "1890",
                    "local_path": "chapters/ch05/source/de-1890.txt",
                    "sha256": sha256_file(source_path),
                    "bytes": source_path.stat().st_size,
                    "status": "passage-verified",
                    "verified": True,
                }
            )
            + "\n",
            encoding="utf-8",
        )

        migrate(root)
        (root / "manifests" / "work-units.jsonl").write_text(
            json.dumps(
                {
                    "unit_id": "ch05-s01",
                    "chapter_id": "ch05",
                    "controller_chapter_id": "ch05",
                    "number": 1,
                    "title_zh": "劳动过程",
                    "scope": "section",
                    "source_path": "chapters/ch05/source/de-1890.txt",
                    "output_path": "reader-edition/第五章 劳动过程和价值增殖过程.md",
                },
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
        buffer = StringIO()
        with redirect_stdout(buffer):
            context(root, "ch05")
        cold_start = json.loads(buffer.getvalue())
        assert cold_start["validation"] == "ok"
        assert cold_start["next_actions"][0]["action"] == "make-tasks"
        assert cold_start["next_actions"][0]["chapter_id"] == "ch05"
        make_tasks(root, "ch05", 1)
        refresh_tasks(root, "ch05")
        tasks = read_jsonl(root / "manifests" / "tasks.jsonl")
        assert len(tasks) == 2
        first_package = root / tasks[0]["task_package_path"]
        assert "## Completion commands" in first_package.read_text(encoding="utf-8")
        for index, task in enumerate(tasks, 1):
            artifact = root / task["artifact_path"]
            artifact.write_text(f"这是第{index}段清楚直接的测试译文。\n", encoding="utf-8")
            task_update(root, task["task_id"], "in_progress", None, None)
            task_update(root, task["task_id"], "drafted", None, None)
            meaning = (
                root
                / "chapters"
                / "ch05"
                / "reviews"
                / f"{task['task_id']}-meaning.md"
            )
            meaning.write_text("意义校对：通过。\n", encoding="utf-8")
            task_update(
                root,
                task["task_id"],
                "meaning_reviewed",
                None,
                meaning.relative_to(root).as_posix(),
            )
            readability = (
                root
                / "chapters"
                / "ch05"
                / "reviews"
                / f"{task['task_id']}-readability.md"
            )
            readability.write_text("可读性校对：通过。\n", encoding="utf-8")
            task_update(
                root,
                task["task_id"],
                "readability_reviewed",
                None,
                readability.relative_to(root).as_posix(),
            )
            task_update(root, task["task_id"], "approved", None, None)

        chapter_advance(root, "ch05", "drafted")
        chapter_advance(root, "ch05", "meaning_reviewed")
        chapter_advance(root, "ch05", "readability_reviewed")
        assemble(root, "ch05")
        output = root / "reader-edition" / "第五章 劳动过程和价值增殖过程.md"
        assert output.is_file()
        assert "v1-ch" not in output.read_text(encoding="utf-8")
        register_version(root, "ch05-s01", "测试版本", None, True)
        versions = read_jsonl(root / "manifests" / "unit-versions.jsonl")
        assert versions[0]["version_id"] == "ch05-s01-v1"
        rebuild_chapter(root, "ch05")
        assert output.read_text(encoding="utf-8").count("# 第五章") == 1
        assert not validate(root)
        revise_tasks(root, "ch05")
        revised = read_jsonl(root / "manifests" / "tasks.jsonl")
        assert len(revised) == 4
        assert all(row["status"] == "superseded" for row in revised[:2])
        assert all(row["status"] == "pending" for row in revised[2:])
        assert all(row["revision"] == 2 for row in revised[2:])
        refresh_tasks(root, "ch05")
        assert not validate(root)
    print("OK: reader project controller end-to-end")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
