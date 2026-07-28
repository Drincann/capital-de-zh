---
name: translate-capital-de-zh
description: Translate Karl Marx's Capital directly from verified German editions into clear, concise, natural modern Chinese, while collating author-revised French and other German editions. Use for source acquisition, edition comparison, paragraph alignment, direct German-to-Chinese translation, terminology decisions, semantic and readability QA, sample translation, or persistent chapter/book-scale translation projects. Do not use this skill merely to modernize an existing Chinese translation or to create a reading guide.
---

# Translate Capital from German to Modern Chinese

Produce a new translation, not a rewrite of an existing Chinese edition. Make the
argument accessible by writing good modern Chinese while preserving every material
claim, distinction, qualification, example, formula, citation, and rhetorical move.

## Read the required references

- Before selecting or extracting sources, read
  [references/edition-policy.md](references/edition-policy.md) completely.
- Before drafting or reviewing any translation, read
  [references/translation-standard.md](references/translation-standard.md) completely.
- For work longer than one passage, read
  [references/project-schema.md](references/project-schema.md) completely.

## Default edition contract

Unless the user chooses otherwise:

1. Use a reliable scholarly or human-corrected machine-readable text, never raw
   OCR, as the translation base.
2. For the no-cost public-source project, use the official MEGAdigital text of the
   1890 German fourth edition as the base.
3. Collate the human-corrected 1872–1875 French edition continuously as an
   author-revised witness.
4. Consult the 1872 German second edition as the principal authorial witness, but
   use a passage only after checking it against the facsimile.
5. Consult the official MEGAdigital text of the 1867 German first edition where
   textual history or a major recasting matters.

If a reliable full text of the 1872 second edition is later supplied, the project
may switch its base through an explicit editorial decision.

Translate one historically real base edition. Never silently manufacture a
composite German text. If a non-base witness materially improves or changes the
Chinese main text, record the decision and identify the witness.

## Non-negotiable rules

- Draft from the verified German base, not from a Chinese translation.
- Do not read an existing Chinese translation before the independent first draft
  unless the user explicitly requests comparison.
- Treat OCR as untrusted. Verify title page, edition, paragraph boundaries,
  emphasis, notes, numbers, formulas, tables, and suspicious words against a scan
  or a checked transcription.
- Translate propositions, not German word order.
- Prefer present-day Chinese vocabulary and syntax. Split long sentences when the
  logical relation remains explicit.
- Do not add explanations to the main text. Clarity must come primarily from
  syntax, explicit referents, and well-chosen words.
- Do not preserve inherited Chinese technical terms automatically. Decide each
  recurring term from its German meaning and function in the argument.
- Do not add first-use parenthetical aliases or a reading guide by default.
- Keep notes sparse and textual: edition differences, unavoidable ambiguity,
  citations, wordplay, or a decision a reader must know.
- Preserve uncertainty, modality, scope, negation, irony, and polemical force.

## Workflow

### 1. Lock the source

Record edition, language, year, repository, stable URL, local file, checksum, and
verification status. Keep OCR/transcription beside its facsimile reference.

### 2. Build paragraph alignment

Give every base paragraph a stable ID. Align the corresponding French and later
German witnesses. Mark absent, moved, split, joined, added, and substantively
changed passages; do not force false one-to-one alignment.

### 3. Parse before translating

For each paragraph identify:

- main claim and supporting claims;
- logical relations and the scope of negation or qualification;
- pronoun and demonstrative referents;
- recurring terms and contrasts;
- examples, quantities, citations, and footnotes;
- rhetorical tone and any ambiguity that cannot be responsibly resolved.

This analysis is internal working material, not a reader guide.

### 4. Draft independent modern Chinese

Write from the parsed meaning. Use the shortest natural wording that preserves the
argument. Reorder clauses, restore omitted subjects when recoverable, and split
sentences where necessary. Never simplify by deleting a step of reasoning.

### 5. Collate witnesses

Compare the draft with the French edition and, where material, the German second
edition. Classify every material difference using the codes in the edition policy.
Update the main text only through a recorded decision.

### 6. Audit

Run two separate passes:

- semantic audit against the source: claims, logic, terms, figures, names, notes;
- Chinese audit without looking at the source: readability, reference clarity,
  sentence rhythm, needless abstraction, and avoidable translationese.

Do not let readability review weaken or invent claims.

### 7. Deliver

For a sample, deliver the clean Chinese translation, its exact German source, and
only essential textual notes. For a chapter project, keep source and translation
files adjacent as defined in the project schema.

## Persistent work

For multi-section work, initialize a project with:

```powershell
python scripts/init_project.py <project-root> --project-id <id> --title <title>
```

Resume only from the project files, never from conversational memory alone. Before
starting a chunk, verify the source lock and last approved translation decision.
After finishing it, save the draft, variants, decisions, QA result, and progress
event before proceeding.

Register downloaded source files with:

```powershell
python scripts/register_source.py <project-root> <source-id> <local-file>
```

Validate the durable state with:

```powershell
python scripts/validate_project.py <project-root>
```

Stop and repair the project state if validation fails.
