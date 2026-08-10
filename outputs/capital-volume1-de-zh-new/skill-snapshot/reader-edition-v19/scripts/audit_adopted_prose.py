#!/usr/bin/env python3
"""Extract connector and relational-term candidates from adopted reader versions."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


CONNECTORS = (
    "但是",
    "但",
    "不过",
    "可是",
    "然而",
    "固然",
    "当然",
    "尽管",
    "虽然",
    "因此",
    "所以",
    "因而",
    "于是",
    "而且",
    "并且",
    "同时",
    "仍然",
    "反过来",
    "换句话说",
    "也就是说",
    "却",
)
CONNECTOR_RE = re.compile("|".join(map(re.escape, CONNECTORS)))
SENTENCE_RE = re.compile(r"[^。！？!?]+[。！？!?]?", re.MULTILINE)
RELATIONAL_TERM_RE = re.compile(
    r"“([^”\n]{1,24}(?:形式|关系|位置|角色|作用|职能|方向|两极|方面|"
    r"基准|尺度|标准|比例|比率|率|等价物|表现|界限|范围|阶段|环节))”"
)
KNOWN_RELATIONAL_TERMS = (
    "相对价值形式",
    "等价形式",
    "简单价值形式",
    "扩大价值形式",
    "一般价值形式",
    "货币形式",
    "相对价值",
    "交换价值",
    "等价物",
    "剩余价值率",
    "年剩余价值率",
    "利润率",
    "必要劳动",
    "剩余劳动",
    "必要产品",
    "剩余产品",
    "不变资本",
    "可变资本",
    "资本的技术构成",
    "资本的价值构成",
    "资本的有机构成",
)


def load_jsonl(path: Path) -> list[dict]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def prose_paragraphs(text: str) -> list[str]:
    paragraphs: list[str] = []
    for block in re.split(r"\n\s*\n", text):
        stripped = block.strip()
        if not stripped or stripped.startswith("#"):
            continue
        lines = [line.strip() for line in stripped.splitlines()]
        prose = " ".join(line for line in lines if not line.startswith("#")).strip()
        if prose:
            paragraphs.append(prose)
    return paragraphs


def sentences(paragraph: str) -> list[str]:
    return [match.group(0).strip() for match in SENTENCE_RE.finditer(paragraph) if match.group(0).strip()]


def connector_candidates(unit_id: str, version_id: str, text: str) -> list[dict]:
    rows: list[dict] = []
    for paragraph_index, paragraph in enumerate(prose_paragraphs(text), 1):
        parts = sentences(paragraph)
        for sentence_index, sentence in enumerate(parts, 1):
            for match in CONNECTOR_RE.finditer(sentence):
                before = sentence[: match.start()].strip(" ，,：:；;—-（(")
                after = sentence[match.end() :].strip()
                left = before or (parts[sentence_index - 2] if sentence_index > 1 else "")
                right = after or (parts[sentence_index] if sentence_index < len(parts) else "")
                rows.append(
                    {
                        "kind": "connector",
                        "unit_id": unit_id,
                        "version_id": version_id,
                        "paragraph": paragraph_index,
                        "sentence": sentence_index,
                        "connector": match.group(0),
                        "left_proposition_context": left,
                        "right_proposition_context": right,
                        "sentence_text": sentence,
                        "previous_sentence": parts[sentence_index - 2] if sentence_index > 1 else "",
                        "next_sentence": parts[sentence_index] if sentence_index < len(parts) else "",
                    }
                )
    return rows


def relational_candidates(unit_id: str, version_id: str, text: str) -> list[dict]:
    rows: list[dict] = []
    seen: set[str] = set()
    paragraphs = prose_paragraphs(text)
    for paragraph_index, paragraph in enumerate(paragraphs, 1):
        found = [match.group(1) for match in RELATIONAL_TERM_RE.finditer(paragraph)]
        found.extend(term for term in KNOWN_RELATIONAL_TERMS if term in paragraph)
        for term in found:
            if term in seen:
                continue
            seen.add(term)
            rows.append(
                {
                    "kind": "relational_first_use",
                    "unit_id": unit_id,
                    "version_id": version_id,
                    "paragraph": paragraph_index,
                    "term": term,
                    "paragraph_text": paragraph,
                }
            )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("project_root")
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--unit-pattern",
        default=".*",
        help="Regular expression matched against unit_id.",
    )
    args = parser.parse_args()

    root = Path(args.project_root).resolve()
    output = Path(args.output)
    if not output.is_absolute():
        output = root / output
    unit_pattern = re.compile(args.unit_pattern)

    adoptions = json.loads(
        (root / "manifests" / "adoptions.json").read_text(encoding="utf-8")
    )
    versions = {
        row["version_id"]: row
        for row in load_jsonl(root / "manifests" / "unit-versions.jsonl")
    }

    rows: list[dict] = []
    selected_units = 0
    for unit_id, version_id in sorted(adoptions.items()):
        if not unit_pattern.search(unit_id):
            continue
        version = versions.get(version_id)
        if version is None:
            raise SystemExit(f"Adopted version missing from manifest: {version_id}")
        artifact = root / version["artifact_path"]
        text = artifact.read_text(encoding="utf-8")
        selected_units += 1
        rows.extend(connector_candidates(unit_id, version_id, text))
        rows.extend(relational_candidates(unit_id, version_id, text))

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "units": selected_units,
                "connector_candidates": sum(row["kind"] == "connector" for row in rows),
                "relational_first_use_candidates": sum(
                    row["kind"] == "relational_first_use" for row in rows
                ),
                "output": str(output),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
