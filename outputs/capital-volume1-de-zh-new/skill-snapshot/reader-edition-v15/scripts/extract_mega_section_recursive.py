#!/usr/bin/env python3
"""Extract a MEGAdigital section including nested subheadings and paragraphs."""

from __future__ import annotations

import argparse
import re
import xml.etree.ElementTree as ET
from pathlib import Path


NS = {"tei": "http://www.tei-c.org/ns/1.0"}


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def normalize_space(value: str) -> str:
    value = value.replace("\u00ad", "")
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r"\s+([,.;:!?])", r"\1", value)
    return value.strip()


def repair_lineation(value: str) -> str:
    return re.sub(
        r"(\w)-\s+(?!und\b|oder\b)([a-zäöüß])",
        r"\1\2",
        normalize_space(value),
    )


def element_text(element: ET.Element) -> str:
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
    return repair_lineation("".join(chunks))


def find_container(root: ET.Element, heading: str) -> ET.Element:
    wanted = normalize_space(heading).casefold()
    parent = {child: node for node in root.iter() for child in node}
    matches = [
        head
        for head in root.findall(".//tei:head", NS)
        if wanted in element_text(head).casefold()
    ]
    if len(matches) != 1:
        raise SystemExit(f"Expected one heading; found {len(matches)}")
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
    parent = {child: node for node in root.iter() for child in node}
    top_head = next(
        (child for child in container if local_name(child.tag) == "head"), None
    )
    page = ""
    for node in root.iter():
        if node is container:
            break
        if local_name(node.tag) == "pb" and node.get("ed") != "manuscript":
            page = node.get("n", page)

    def inside_note(node: ET.Element) -> bool:
        current = node
        while current in parent and parent[current] is not container:
            current = parent[current]
            if local_name(current.tag) == "note":
                return True
        return False

    items: list[dict[str, str]] = []
    notes: list[dict[str, str]] = []
    for node in container.iter():
        name = local_name(node.tag)
        if name == "pb" and node.get("ed") != "manuscript":
            page = node.get("n", page)
        elif name == "head" and node is not top_head and not inside_note(node):
            text = element_text(node)
            if text:
                items.append({"kind": "heading", "text": text, "pages": page})
        elif name == "p" and not inside_note(node):
            text = element_text(node)
            if not text:
                continue
            if node.get("n") == "cE" and items and items[-1]["kind"] == "paragraph":
                items[-1]["text"] = repair_lineation(items[-1]["text"] + " " + text)
                if page and page not in items[-1]["pages"].split(","):
                    items[-1]["pages"] += f",{page}"
            else:
                items.append({"kind": "paragraph", "text": text, "pages": page})
        elif name == "note" and node.get("type") == "footnote":
            text = element_text(node)
            if node.get("prev") and notes:
                notes[-1]["text"] = repair_lineation(notes[-1]["text"] + " " + text)
            elif text:
                notes.append({"text": text, "pages": page})

    output = [
        f"# {element_text(top_head) if top_head is not None else args.heading}",
        "",
        f"Source authority: {args.authority}",
        f"Source file: {args.xml_file.name}",
        "Working extraction; the TEI XML remains canonical.",
        "",
    ]
    for number, item in enumerate(items, 1):
        locator = f"[MEGA p.{item['pages'] or '?'}]"
        if item["kind"] == "heading":
            locator += " [heading]"
        output.extend(
            [
                f"[{args.id_prefix}-p{number:04d}] {locator}",
                item["text"],
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
    print(f"{args.output}\titems={len(items)}\tnotes={len(notes)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
