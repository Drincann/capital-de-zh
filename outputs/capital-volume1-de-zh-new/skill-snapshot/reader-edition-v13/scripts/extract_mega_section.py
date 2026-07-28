#!/usr/bin/env python3
"""Extract a paragraph-preserving working text from a MEGAdigital TEI section."""

from __future__ import annotations

import argparse
import re
import xml.etree.ElementTree as ET
from pathlib import Path


NS = {"tei": "http://www.tei-c.org/ns/1.0"}
XML_ID = "{http://www.w3.org/XML/1998/namespace}id"


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def normalize_space(value: str) -> str:
    value = value.replace("\u00ad", "")
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r"\s+([,.;:!?])", r"\1", value)
    return value.strip()


def repair_lineation(value: str) -> str:
    value = re.sub(
        r"(\w)-\s+(?!und\b|oder\b)([a-zäöüß])",
        r"\1\2",
        normalize_space(value),
    )
    return value


def element_text(element: ET.Element) -> str:
    """Read visible text while omitting MEGA manuscript-page overlay markers."""

    chunks: list[str] = []

    def visit(node: ET.Element) -> None:
        name = local_name(node.tag)
        if name == "add" and node.get("type", "").startswith("mpb"):
            if node.tail:
                chunks.append(node.tail.lstrip())
            return
        if name == "label" and node.get("type") == "mpb":
            if node.tail:
                chunks.append(node.tail.lstrip())
            return
        if name == "pb" and node.get("ed") == "manuscript":
            if node.tail:
                chunks.append(node.tail.lstrip())
            return
        if node.text:
            chunks.append(node.text)
        for child in node:
            visit(child)
        if node.tail:
            chunks.append(node.tail)

    visit(element)
    # Repair print-line hyphenation conservatively. Keep coordination forms such
    # as "Dampf- und" intact.
    return repair_lineation("".join(chunks))


def direct_page(element: ET.Element) -> str | None:
    for child in element:
        if local_name(child.tag) == "pb" and child.get("ed") != "manuscript":
            return child.get("n")
    return None


def find_container(root: ET.Element, heading: str) -> ET.Element:
    wanted = normalize_space(heading).casefold()
    parent = {child: node for node in root.iter() for child in node}
    matches = []
    for head in root.findall(".//tei:head", NS):
        if wanted in element_text(head).casefold():
            matches.append(head)
    if len(matches) != 1:
        candidates = [element_text(head) for head in matches[:10]]
        raise SystemExit(
            f"Expected one heading containing {heading!r}; found {len(matches)}: {candidates}"
        )
    node = matches[0]
    while node in parent:
        node = parent[node]
        if local_name(node.tag).startswith("div"):
            return node
    raise SystemExit("Matched heading has no div container")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("xml_file", type=Path)
    parser.add_argument("--heading", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--id-prefix", required=True)
    parser.add_argument("--authority", default="MEGA II/10")
    args = parser.parse_args()

    root = ET.parse(args.xml_file).getroot()
    container = find_container(root, args.heading)
    headings: list[str] = []
    paragraphs: list[dict[str, str]] = []
    notes: list[dict[str, str]] = []
    page = ""
    for node in root.iter():
        if node is container:
            break
        if local_name(node.tag) == "pb" and node.get("ed") != "manuscript":
            page = node.get("n", page)

    for child in container:
        name = local_name(child.tag)
        if name == "pb" and child.get("ed") != "manuscript":
            page = child.get("n", page)
            continue
        if name == "head":
            headings.append(element_text(child))
            continue
        if name == "p":
            text = element_text(child)
            kind = child.get("n", "")
            if kind == "cE" and paragraphs:
                paragraphs[-1]["text"] = repair_lineation(
                    paragraphs[-1]["text"] + " " + text
                )
                if page and page not in paragraphs[-1]["pages"].split(","):
                    paragraphs[-1]["pages"] += f",{page}"
            elif text:
                paragraphs.append({"text": text, "pages": page})
            continue
        if name == "note" and child.get("type") == "footnote":
            text = element_text(child)
            if child.get("prev") and notes:
                notes[-1]["text"] = repair_lineation(notes[-1]["text"] + " " + text)
            else:
                notes.append(
                    {
                        "text": text,
                        "pages": page,
                        "xml_id": child.get(XML_ID, ""),
                    }
                )

    output: list[str] = [
        f"# {' — '.join(headings)}",
        "",
        f"Source authority: {args.authority}",
        f"Source file: {args.xml_file.name}",
        "Working extraction; the TEI XML remains canonical.",
        "",
    ]
    for number, paragraph in enumerate(paragraphs, 1):
        paragraph_id = f"{args.id_prefix}-p{number:04d}"
        pages = paragraph["pages"] or "?"
        output.extend(
            [
                f"[{paragraph_id}] [MEGA p.{pages}]",
                paragraph["text"],
                "",
            ]
        )
    if notes:
        output.extend(["## Footnotes", ""])
        for number, note in enumerate(notes, 1):
            output.extend(
                [
                    f"[note-{number:03d}] [MEGA p.{note['pages'] or '?'}]",
                    note["text"],
                    "",
                ]
            )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(output), encoding="utf-8", newline="\n")
    print(f"{args.output}\tparagraphs={len(paragraphs)}\tnotes={len(notes)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
