#!/usr/bin/env python3
"""Extract a human-corrected section from a Wikisource single-page HTML book."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from bs4 import BeautifulSoup, Tag


def clean_text(node: Tag) -> str:
    clone = BeautifulSoup(str(node), "html.parser")
    for marker in clone.select(".pagenum, .ws-pagenum"):
        marker.decompose()
    text = clone.get_text(" ", strip=True)
    text = text.replace("\u00a0", " ").replace("\u202f", " ")
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    return text.strip()


def page_numbers(node: Tag) -> list[str]:
    pages = []
    for marker in node.select(".pagenum, .ws-pagenum"):
        page = marker.get("id") or ""
        if page and page not in pages:
            pages.append(page)
    return pages


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("html_file", type=Path)
    parser.add_argument("--heading", required=True)
    parser.add_argument("--heading-tag", choices=["h3", "h4", "h5", "h6"])
    parser.add_argument("--stop-text")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--id-prefix", required=True)
    args = parser.parse_args()

    soup = BeautifulSoup(args.html_file.read_text(encoding="utf-8"), "html.parser")
    wanted = re.sub(r"\s+", " ", args.heading).casefold()
    candidates = [
        tag
        for tag in soup.find_all(["h3", "h4", "h5", "h6"])
        if (not args.heading_tag or tag.name == args.heading_tag)
        and wanted in clean_text(tag).casefold()
    ]
    if len(candidates) != 1:
        raise SystemExit(
            f"Expected one heading containing {args.heading!r}; found "
            f"{len(candidates)}: {[clean_text(tag) for tag in candidates[:10]]}"
        )
    heading = candidates[0]
    level = int(heading.name[1])
    prior = heading.find_all_previous(class_=re.compile(r"(?:^|\s)(?:ws-)?pagenum(?:\s|$)"))
    page = (prior[0].get("id") if prior else "") or ""
    paragraphs: list[dict[str, str]] = []

    for sibling in heading.next_siblings:
        if not isinstance(sibling, Tag):
            continue
        if args.stop_text and args.stop_text.casefold() in clean_text(sibling).casefold():
            break
        if re.fullmatch(r"h[1-6]", sibling.name or ""):
            sibling_level = int(sibling.name[1])
            if sibling_level <= level:
                break
        if sibling.name != "p":
            continue
        pages = page_numbers(sibling)
        if pages:
            page = pages[-1]
        text = clean_text(sibling)
        if text:
            paragraphs.append({"text": text, "pages": ",".join(pages) or page})

    output = [
        f"# {clean_text(heading)}",
        "",
        "Source: Wikisource human-corrected transcription of the 1872–1875 French edition.",
        f"Source file: {args.html_file.name}",
        "",
    ]
    for number, paragraph in enumerate(paragraphs, 1):
        output.extend(
            [
                f"[{args.id_prefix}-p{number:04d}] [French ed. p.{paragraph['pages'] or '?'}]",
                paragraph["text"],
                "",
            ]
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(output), encoding="utf-8", newline="\n")
    print(f"{args.output}\tparagraphs={len(paragraphs)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
