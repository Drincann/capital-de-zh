#!/usr/bin/env python3
"""End-to-end smoke test for the durable reader-edition controller."""

from __future__ import annotations

import json
import tempfile
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

from reader_project_controller import (
    adopt_version,
    assemble,
    chapter_advance,
    context,
    make_tasks,
    migrate,
    read_jsonl,
    rebuild_chapter,
    refresh_tasks,
    register_version,
    review_errors,
    review_return_budget,
    revise_tasks,
    sha256_file,
    sha256_text,
    source_blocks_with_referenced_notes,
    task_update,
    validate,
    write_jsonl,
)


def main() -> int:
    assert review_return_budget(10, 20_000) == 2
    assert review_return_budget(11, 20_000) == 3
    assert review_return_budget(20, 30_000) == 3
    assert review_return_budget(21, 10_000) == 4
    assert review_return_budget(5, 30_001) == 4
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        mismatch_source = root / "mismatched-note.txt"
        mismatch_source.write_text(
            """[v1-test-p0001]
Ein Verweis 24a).

## Footnotes

[note-001] [MEGA p.1]
24) A note whose printed definition omitted the suffix.
""",
            encoding="utf-8",
        )
        mismatch_group = [
            {
                "block": "[v1-test-p0001]\nEin Verweis 24a).",
                "id": "v1-test-p0001",
                "locator": "",
            }
        ]
        mismatched_package = source_blocks_with_referenced_notes(
            mismatch_source, mismatch_group
        )
        assert "24a) A note" in mismatched_package
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
Der Gebrauch der Arbeitskraft ist die Arbeit selbst 1).

[v1-ch05-s01-p0002] [MEGA p.162]
Die Arbeit ist zunächst ein Proceß zwischen Mensch und Natur.

## Footnotes

[note-001] [MEGA p.161]
1) Test.
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
        original_source = source_path.read_text(encoding="utf-8")
        source_path.write_text(
            original_source.replace(
                "[note-001] [MEGA p.161]",
                "[note-999] [MEGA p.161,162]",
            ),
            encoding="utf-8",
        )
        migrate(root)
        metadata_only_errors = validate(root, quiet=True)
        assert not any(
            "task source is stale against current chapter source" in error
            for error in metadata_only_errors
        ), metadata_only_errors
        source_path.write_text(original_source, encoding="utf-8")
        migrate(root)
        source_path.write_text(
            original_source.replace("1) Test.", "1) Changed note."),
            encoding="utf-8",
        )
        migrate(root)
        stale_source_errors = validate(root, quiet=True)
        assert any(
            "task source is stale against current chapter source"
            in error
            for error in stale_source_errors
        ), stale_source_errors
        source_path.write_text(original_source, encoding="utf-8")
        migrate(root)
        refresh_tasks(root, "ch05")
        tasks = read_jsonl(root / "manifests" / "tasks.jsonl")
        assert len(tasks) == 2
        write_jsonl(root / "manifests" / "tasks.jsonl", tasks[:-1])
        coverage_errors = validate(root, quiet=True)
        assert any(
            "active tasks do not cover source paragraphs exactly once"
            in error
            and "p0002" in error
            for error in coverage_errors
        )
        write_jsonl(root / "manifests" / "tasks.jsonl", tasks)
        first_package = root / tasks[0]["task_package_path"]
        package_text = first_package.read_text(encoding="utf-8")
        assert "## Main-agent-only completion commands" not in package_text
        assert "reader_project_controller.py task-update" not in package_text
        assert "report its path and stop" in package_text
        for index, task in enumerate(tasks, 1):
            artifact = root / task["artifact_path"]
            artifact.write_text(f"这是第{index}段清楚直接的测试译文。\n", encoding="utf-8")
            task_update(root, task["task_id"], "in_progress", None, None)
            if index == 1:
                refresh_tasks(root, "ch05", [task["task_id"]])
            task_update(root, task["task_id"], "drafted", None, None)
            if index == 1:
                refresh_tasks(root, "ch05", [task["task_id"]])
            meaning = (
                root
                / "chapters"
                / "ch05"
                / "reviews"
                / f"{task['task_id']}-meaning.md"
            )
            draft_hash = sha256_file(artifact)
            meaning.write_text(
                f"""# 意义审校

Review-Type: meaning
Task-ID: {task['task_id']}
Draft-SHA256: {draft_hash}
Verdict: PASS

## Source argument map

- [{task['start_paragraph']}]: 测试源段的核心命题已经保留。

## Claim and logic audit

核心命题、关系和限定均已核对。

## Changes and uncertainty

未使用深度重构，无未解决不确定性。
""",
                encoding="utf-8",
            )
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
            readability.write_text(
                f"""# 可读性审校

Review-Type: readability
Task-ID: {task['task_id']}
Source-Blind: YES
Draft-SHA256: {draft_hash}
Verdict: PASS

## One-read paraphrases

- C1: 这是一段清楚直接的测试译文。

## Reader questions

- C1 Q: 这段是否清楚？ A: 清楚。

## Transition evidence

- C1: 单句，无相邻句关系。
- Connector-Pairs: none

## Scope and closure audit

- None.

## Second-read risks

- None in current draft.
- Relational-First-Use: 本测试段未引入关系型术语。

## Paragraph and punctuation audit

Boundary-Changes: none
Semicolons: 0
""",
                encoding="utf-8",
            )
            missing_new_evidence = readability.with_name(
                f"{task['task_id']}-readability-missing-v19-evidence.md"
            )
            missing_new_evidence.write_text(
                readability.read_text(encoding="utf-8")
                .replace("- Connector-Pairs: none\n", "")
                .replace(
                    "- Relational-First-Use: 本测试段未引入关系型术语。\n",
                    "",
                ),
                encoding="utf-8",
            )
            new_evidence_errors = review_errors(
                root,
                task,
                missing_new_evidence,
                "readability",
            )
            assert any("Connector-Pairs" in error for error in new_evidence_errors)
            assert any(
                "Relational-First-Use" in error for error in new_evidence_errors
            )
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
        version_text = output.read_text(encoding="utf-8").strip() + "\n"
        independent = root / "chapters" / "ch05" / "reviews" / "independent.md"
        independent.write_text(
            f"""# 独立读者审校

Review-Type: independent-reader
Unit-ID: ch05-s01
Artifact-SHA256: {sha256_text(version_text)}
Reviewer-Context: smoke-test-reader
Source-Access: NO
Verdict: PASS

## Overall assessment

中文表达清楚，未发现翻译造成的理解障碍。

## Paragraph findings

各段均可一次复述。

## Failure probes

未发现指代、关系或术语障碍；不以理论认同作为判定标准。
""",
            encoding="utf-8",
        )
        register_version(
            root,
            "ch05-s01",
            "测试版本",
            None,
            independent.relative_to(root).as_posix(),
            True,
            False,
            "",
        )
        versions = read_jsonl(root / "manifests" / "unit-versions.jsonl")
        assert versions[0]["version_id"] == "ch05-s01-v1"
        assert versions[0]["review_status"] == "passed"
        rebuild_chapter(root, "ch05")
        assert output.read_text(encoding="utf-8").count("# 第五章") == 1
        task_rows = read_jsonl(root / "manifests" / "tasks.jsonl")
        task_rows[0]["review_status"] = "needs_review"
        task_rows[0]["review_note"] = "任务终审仍有一处待人工判断。"
        write_jsonl(root / "manifests" / "tasks.jsonl", task_rows)
        upstream_review = (
            root
            / "chapters"
            / "ch05"
            / "reviews"
            / "ch05-s01-upstream-task-review.md"
        )
        upstream_review.write_text(
            f"""# 独立读者审校

Review-Type: independent-reader
Unit-ID: ch05-s01
Artifact-SHA256: {sha256_text(version_text)}
Reviewer-Context: smoke-test-reader-upstream
Source-Access: NO
Verdict: PASS

## Overall assessment

中文本身可以顺畅阅读。

## Paragraph findings

各段均可一次复述。

## Failure probes

未发现独立的中文理解障碍。
""",
            encoding="utf-8",
        )
        register_version(
            root,
            "ch05-s01",
            "继承任务级待复核状态的测试版本",
            None,
            upstream_review.relative_to(root).as_posix(),
            False,
            False,
            "",
        )
        versions = read_jsonl(root / "manifests" / "unit-versions.jsonl")
        assert versions[1]["version_id"] == "ch05-s01-v2"
        assert versions[1]["reader_review_verdict"] == "PASS"
        assert versions[1]["review_status"] == "needs_review"
        assert versions[1]["review_note"] == "任务终审仍有一处待人工判断。"
        assert versions[1]["unresolved_task_ids"] == [
            task_rows[0]["task_id"]
        ]
        task_rows[0]["review_status"] = "passed"
        task_rows[0].pop("review_note", None)
        write_jsonl(root / "manifests" / "tasks.jsonl", task_rows)
        unresolved = (
            root
            / "chapters"
            / "ch05"
            / "reviews"
            / "ch05-s01-independent-r3.md"
        )
        unresolved.write_text(
            f"""# 独立读者终审

Review-Type: independent-reader
Unit-ID: ch05-s01
Artifact-SHA256: {sha256_text(version_text)}
Reviewer-Context: smoke-test-reader-r3
Source-Access: NO
Verdict: FAIL

## Overall assessment

有一处表达仍可能让普通读者误解。

## Paragraph findings

T：测试段的关系仍不够明确。

## Failure probes

读者可能无法稳定判断两句之间的因果关系。
""",
            encoding="utf-8",
        )
        register_version(
            root,
            "ch05-s01",
            "有待复核的测试版本",
            None,
            unresolved.relative_to(root).as_posix(),
            False,
            True,
            "测试段的因果关系仍可能被误解。",
        )
        versions = read_jsonl(root / "manifests" / "unit-versions.jsonl")
        assert versions[2]["version_id"] == "ch05-s01-v3"
        assert versions[2]["review_status"] == "needs_review"
        assert versions[2]["review_note"] == "测试段的因果关系仍可能被误解。"
        try:
            adopt_version(root, "ch05-s01", "ch05-s01-v3")
        except SystemExit as exc:
            assert "cannot be adopted" in str(exc)
        else:
            raise AssertionError("needs_review version was adopted")
        assert not validate(root)
        revise_tasks(root, "ch05")
        revised = read_jsonl(root / "manifests" / "tasks.jsonl")
        assert len(revised) == 4
        assert all(row["status"] == "superseded" for row in revised[:2])
        assert all(row["status"] == "pending" for row in revised[2:])
        assert all(row["revision"] == 2 for row in revised[2:])
        refresh_tasks(root, "ch05")
        assert not validate(root)
        source_path.write_text(
            original_source.replace(
                "## Footnotes",
                """[v1-ch05-s01-p0003] [MEGA p.163]
Ein neuer Absatz nach einer reparierten Quellengrenze.

## Footnotes""",
            ),
            encoding="utf-8",
        )
        source_manifest = read_jsonl(
            root / "sources" / "source-manifest.jsonl"
        )
        source_manifest[0]["sha256"] = sha256_file(source_path)
        source_manifest[0]["bytes"] = source_path.stat().st_size
        write_jsonl(
            root / "sources" / "source-manifest.jsonl",
            source_manifest,
        )
        migrate(root)
        make_tasks(root, "ch05", 1, replace_incomplete=True)
        rechunked = read_jsonl(root / "manifests" / "tasks.jsonl")
        active_rechunked = [
            row for row in rechunked if row["status"] != "superseded"
        ]
        assert len(active_rechunked) == 3
        assert [row["revision"] for row in active_rechunked] == [3, 3, 1]
        assert all(row["dependencies"] for row in active_rechunked[:2])
        assert active_rechunked[2]["dependencies"] == []
        assert not validate(root)
    print("OK: reader project controller end-to-end")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
