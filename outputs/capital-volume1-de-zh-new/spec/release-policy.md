# Release policy

The public edition consists only of UTF-8 Markdown files under `reader-edition/`,
one file per chapter.

A chapter may be released only when:

- every source paragraph is covered once, with no gap or overlap;
- every task is approved after hash-bound, evidence-based meaning and
  source-blind readability review;
- every registered candidate has a hash-bound independent-reader review; a
  bounded third FAIL is marked `needs_review`, is visible for later reader
  judgment, and cannot be auto-adopted or released;
- every recorded artifact hash still matches;
- the assembled Markdown contains no internal IDs, task metadata, or review text;
- the user has approved the chapter or the governing sample style.

Inline translator notes use `〔译者注：……〕`. They are sparse, short, and only
prevent misunderstanding, add indispensable context, or mark interpretation.
