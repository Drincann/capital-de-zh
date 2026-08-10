#!/usr/bin/env python3
"""Extract a MEGAdigital section including nested subheadings and paragraphs."""

from __future__ import annotations

import argparse
import re
import xml.etree.ElementTree as ET
from pathlib import Path


NS = {"tei": "http://www.tei-c.org/ns/1.0"}


def local_name(tag: object) -> str:
    if not isinstance(tag, str):
        return ""
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


def looks_like_unmarked_continuation(previous: str, current: str) -> bool:
    """Recover page-split prose whose continuation lacks cM/cE metadata."""
    previous = previous.rstrip()
    current = current.lstrip()
    if not previous or not current:
        return False
    if re.search(r'[.!?…]["”»’)]*$', previous):
        return False
    if re.match(r"[a-zäöüß]", current):
        return True
    # German nouns are capitalized. A page break can therefore continue an
    # unfinished phrase with an uppercase word (for example, "Masse des" /
    # "Mehrwerths"). Only accept that broader case when the previous fragment
    # ends in a function word that cannot close the sentence on its own.
    return bool(
        re.match(r"[A-ZÄÖÜ]", current)
        and re.search(
            r"\b(?:der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines|"
            r"von|zu|zur|zum|mit|für|durch|gegen|ohne|unter|über|zwischen|"
            r"bei|nach|vor|aus|auf|in|im|an|am|als|und|oder)\s*$",
            previous,
            flags=re.IGNORECASE,
        )
    )


TABLE_BLOCK_PATTERN = re.compile(r"\[table\]\n.*?\n\[/table\]", re.DOTALL)


def repair_text_preserving_tables(value: str) -> str:
    """Repair prose lineation without flattening row-delimited table blocks."""

    tables: list[str] = []

    def shield(match: re.Match[str]) -> str:
        token = f"TABLEBLOCKTOKEN{len(tables)}"
        tables.append(match.group(0))
        return f" {token} "

    text = repair_lineation(TABLE_BLOCK_PATTERN.sub(shield, value))
    for index, table in enumerate(tables):
        text = text.replace(
            f"TABLEBLOCKTOKEN{index}",
            f"\n{table}\n",
        )
    return re.sub(r"[ \t]*\n[ \t]*", "\n", text).strip()


def element_text(
    element: ET.Element,
    *,
    preserve_tables: bool = False,
) -> str:
    chunks: list[str] = []

    def visit(node: ET.Element) -> None:
        if not isinstance(node.tag, str):
            if node.tail:
                chunks.append(node.tail)
            return
        name = local_name(node.tag)
        if preserve_tables and name == "table":
            text = table_text(node)
            if text:
                chunks.append(f"\n{text}\n")
            if node.tail:
                chunks.append(node.tail)
            return
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
    text = "".join(chunks)
    if preserve_tables:
        return repair_text_preserving_tables(text)
    return repair_lineation(text)


def table_text(element: ET.Element) -> str:
    """Preserve a TEI table as row-delimited plain text.

    MEGAdigital uses tables for value equations as well as statistical data.
    Flattening or skipping those nodes can remove argument-bearing formulae, so
    retain every row and every cell, including visibly empty cells.
    """

    rows: list[str] = []
    for row in element.findall(".//tei:row", NS):
        cells = [
            element_text(cell)
            for cell in row.findall("./tei:cell", NS)
        ]
        if cells:
            rows.append(" | ".join(cells))
    if not rows:
        text = element_text(element)
        return f"[table]\n{text}\n[/table]" if text else ""
    return "[table]\n" + "\n".join(rows) + "\n[/table]"


def footnote_label(element: ET.Element) -> str:
    """Return the printed footnote label, such as ``85`` or ``110a``."""

    label = element.find(".//tei:label[@type='footnote']", NS)
    if label is None:
        return ""
    match = re.search(r"\d+[a-z]?", element_text(label), flags=re.IGNORECASE)
    return match.group(0) if match else ""


def footnote_target(element: ET.Element) -> str:
    """Return MEGAdigital's canonical ``ref:id`` from a note comment."""

    for child in element:
        if child.tag is ET.Comment and child.text:
            match = re.search(r'ref:id="([^"]+)"', child.text)
            if match:
                return match.group(1)
    return ""


def referenced_footnotes(
    root: ET.Element,
    container: ET.Element,
) -> list[dict[str, str]]:
    """Resolve footnotes by the reference in the selected text container.

    MEGAdigital occasionally places a note definition just outside the XML
    division containing its reference (for example note 85 at the boundary
    between sections 2 and 3 of chapter 3). Section ownership therefore has
    to follow ``ref[@type='footnote']`` rather than the note node's physical
    parent.
    """

    wanted: list[dict[str, object]] = []
    positions = {node: index for index, node in enumerate(root.iter())}
    for ref in container.findall(".//tei:ref[@type='footnote']", NS):
        match = re.search(r"\d+[a-z]?", element_text(ref), flags=re.IGNORECASE)
        if match:
            wanted.append(
                {
                    "label": match.group(0),
                    "target": ref.get("target", "").lstrip("#"),
                    "position": positions[ref],
                }
            )

    # A printed note may be cited more than once from the same section.  MEGA
    # then repeats the same target and label but provides only one definition.
    # Resolve that definition once instead of treating the second citation as
    # a second, missing note.
    unique_wanted: list[dict[str, object]] = []
    seen_references: set[tuple[str, str]] = set()
    for reference in wanted:
        key = (str(reference["target"]), str(reference["label"]).casefold())
        if key in seen_references:
            continue
        seen_references.add(key)
        unique_wanted.append(reference)
    wanted = unique_wanted

    page = ""
    candidates: list[dict[str, object]] = []
    for node in root.iter():
        name = local_name(node.tag)
        if name == "pb" and node.get("ed") != "manuscript":
            page = node.get("n", page)
        elif name == "note":
            text = element_text(node, preserve_tables=True)
            label = footnote_label(node)
            target = footnote_target(node)
            is_unlabelled_continuation = (
                target.casefold() == "xxx" and not label
            )
            if (
                (node.get("prev") or is_unlabelled_continuation)
                and candidates
                and text
            ):
                candidates[-1]["text"] = repair_text_preserving_tables(
                    str(candidates[-1]["text"]) + " " + text
                )
                old_pages = str(candidates[-1]["pages"])
                if page and page not in old_pages.split(","):
                    candidates[-1]["pages"] = old_pages + f",{page}"
            elif text and (node.get("type") == "footnote" or label):
                candidates.append(
                    {
                        "label": label,
                        "target": target,
                        "text": text,
                        "pages": page,
                        "position": positions[node],
                    }
                )

    resolved: list[dict[str, str]] = []
    used: set[int] = set()
    missing: list[str] = []
    for reference in wanted:
        label = str(reference["label"])
        target = str(reference["target"])
        pool = [
            (index, note)
            for index, note in enumerate(candidates)
            if index not in used and target and note["target"] == target
        ]
        if not pool:
            pool = [
                (index, note)
                for index, note in enumerate(candidates)
                if index not in used and note["label"] == label
            ]
        exact = [entry for entry in pool if entry[1]["label"] == label]
        if exact:
            pool = exact
        if not pool:
            missing.append(label)
            continue
        index, note = min(
            pool,
            key=lambda entry: abs(
                int(entry[1]["position"]) - int(reference["position"])
            ),
        )
        used.add(index)
        text = re.sub(
            r"^\s*\d+[a-z]?\)",
            f"{label})",
            str(note["text"]),
            count=1,
            flags=re.IGNORECASE,
        )
        resolved.append({"text": text, "pages": str(note["pages"])})

    if missing:
        raise SystemExit(
            "Missing footnote definitions for referenced labels: "
            + ", ".join(missing)
        )
    return resolved


def find_container(root: ET.Element, heading: str) -> ET.Element:
    wanted = normalize_space(heading).casefold()
    parent = {child: node for node in root.iter() for child in node}
    heads = list(root.findall(".//tei:head", NS))
    matches = [
        head
        for head in heads
        if wanted == element_text(head).casefold()
    ]
    if not matches:
        matches = [
            head
            for head in heads
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
    parser.add_argument(
        "--skip-leading-heading",
        action="store_true",
        help="drop the first nested heading when it only repeats the chapter title",
    )
    args = parser.parse_args()

    parser = ET.XMLParser(target=ET.TreeBuilder(insert_comments=True))
    root = ET.parse(args.xml_file, parser=parser).getroot()
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

    def inside_any(node: ET.Element, names: set[str]) -> bool:
        current = node
        while current in parent and parent[current] is not container:
            current = parent[current]
            if local_name(current.tag) in names:
                return True
        return False

    items: list[dict[str, str]] = []
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
            if (
                (
                    node.get("n") in {"cM", "cE"}
                    or (
                        not node.get("n")
                        and looks_like_unmarked_continuation(
                            items[-1]["text"] if items else "",
                            text,
                        )
                    )
                )
                and items
                and items[-1]["kind"] == "paragraph"
            ):
                items[-1]["text"] = repair_lineation(items[-1]["text"] + " " + text)
                if page and page not in items[-1]["pages"].split(","):
                    items[-1]["pages"] += f",{page}"
            else:
                items.append({"kind": "paragraph", "text": text, "pages": page})
        elif (
            name == "table"
            and not inside_note(node)
            and not inside_any(node, {"p", "head", "table"})
        ):
            text = table_text(node)
            if not text:
                continue
            # A displayed table normally completes the sentence or heading
            # immediately before it. Attach it there so source paragraph IDs
            # remain stable when a previously omitted table is restored.
            if items:
                items[-1]["text"] = items[-1]["text"].rstrip() + "\n" + text
                if page and page not in items[-1]["pages"].split(","):
                    items[-1]["pages"] += f",{page}"
            else:
                items.append({"kind": "table", "text": text, "pages": page})
    notes = referenced_footnotes(root, container)

    if (
        args.skip_leading_heading
        and items
        and items[0]["kind"] == "heading"
    ):
        items = items[1:]

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
