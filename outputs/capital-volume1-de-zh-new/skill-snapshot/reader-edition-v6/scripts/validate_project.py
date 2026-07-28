#!/usr/bin/env python3
"""Compatibility wrapper for the reader-edition project validator."""

from __future__ import annotations

import argparse
from pathlib import Path

from reader_project_controller import validate


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("project_root", type=Path)
    args = parser.parse_args()
    return 1 if validate(args.project_root.resolve()) else 0


if __name__ == "__main__":
    raise SystemExit(main())
