---
name: translate-capital-de-zh
description: Create a plain-language modern-Chinese reader's edition of Karl Marx's Capital from verified German text, prioritizing one-read comprehension for high-school and undergraduate readers while preserving the core argument. Use for direct German-to-Chinese translation, reader-first rewriting, source acquisition, edition comparison, inline translator notes, readability QA, sample chapters, or durable chapter/book-scale translation projects. Do not use merely to modernize an existing Chinese translation or to create a separate reading guide.
---

# Translate Capital into a Plain-Chinese Reader's Edition

Create a new Chinese reader's edition from the German source. The final book is
for ordinary educated readers, not specialists. Make Marx's argument directly
understandable in the main text instead of asking the reader to decode German
syntax, inherited translationese, or an academic apparatus.

This is a faithful modern translation, not a line-by-line crib and not a
commentary. Stay close to the source in claims, logic, distinctions, sequence,
examples, qualifications, and rhetorical movement—not in German-shaped wording.
Write the shortest direct Chinese that preserves those things. Changing parts of
speech, replacing an abstract noun with an action, and choosing “它有什么、它有
多少” over “从质和量两方面考察” are normal translation. Use freer
meaning-centered reconstruction only when direct natural Chinese still leaves a
normal reader unable to understand the source.
Never reverse a claim, alter a causal or conditional relation, merge key
conceptual distinctions, invent evidence, or present the translator's
interpretation as Marx's uncontested statement.

## Read the required references

- Before selecting or extracting sources, read
  [references/edition-policy.md](references/edition-policy.md) completely.
- Before drafting or reviewing any translation, read
  [references/translation-standard.md](references/translation-standard.md)
  completely.
- Before writing or accepting a review, read
  [references/review-protocol.md](references/review-protocol.md) completely.
- For work longer than one passage, read
  [references/project-schema.md](references/project-schema.md) completely.
- Before starting or resuming an existing project, read
  [references/project-operations.md](references/project-operations.md)
  completely.

## Reader-facing contract

- Target a reader with high-school or undergraduate education and no prior
  economics or philosophy training.
- Write natural present-day Chinese with explicit subjects, short sentences, and
  visible logical connections.
- Use semicolons sparingly. They carry no conceptual meaning. Keep one only when
  two complete clauses form a direct parallel or contrast that becomes less
  clear when separated.
- Keep one argument moving continuously through a paragraph. Do not make the
  reader reconnect individually clear sentences after the conceptual subject or
  viewpoint has silently changed.
- Treat the source paragraph as the default paragraph boundary. Do not split a
  paragraph merely to shorten the page or make the prose look lighter. Split or
  join source paragraphs only when sentence-level rewriting cannot otherwise
  achieve one-read comprehension, and record the reason in the readability
  review.
- Translate the meaning and argumentative function, not the German word order.
- Keep the source's content close while making the Chinese as short, concrete,
  and direct as possible. Lexical resemblance to German is not fidelity. Do not
  expand a passage merely because its theory is difficult, disputable,
  compressed, or completed later in the book.
- A reader should normally be able to paraphrase a paragraph after one reading.
- Explain a compressed step inside the prose when the explanation is securely
  entailed by the surrounding argument.
- Use `〔译者注：……〕` at the exact point where a brief note prevents a likely
  misunderstanding, supplies essential historical context, or marks a genuine
  interpretive choice. Keep it to one or two sentences and normally no more than
  one note per paragraph.
- Do not put source IDs, German text, task markers, textual apparatus, or QA
  records in the final book.
- Deliver one clean Markdown file per chapter.

Reject sentences that merely reproduce foreign syntax. For example, do not write
“所有那些通过劳动只是同土地脱离直接联系的东西”. Write the actual meaning:
“有些劳动只是把现成的自然物从原来的环境中取出来，比如捕鱼、伐木和采矿。”

## Source contract

Unless the user chooses otherwise:

1. Use the official MEGAdigital text of the 1890 German fourth edition as the
   continuous base.
2. Consult Marx's author-revised 1872–1875 French edition where it clarifies,
   simplifies, adds, or materially changes the exposition.
3. Consult the 1872 German second edition and 1867 first edition only when a
   passage or textual decision needs them.
4. Treat OCR as a search aid, never as trusted source text.

The final prose may be reader-first, but its factual and argumentative foundation
must remain traceable to a verified historical source. Record any material use of
a non-base witness in the internal decision log.

## Workflow

1. Lock the exact source and checksum.
2. Parse each source passage for its core claim, logical relations, examples,
   key contrasts, likely reader misunderstandings, and argument spine: the
   question, stable conceptual subject, function of each step, and reason each
   step follows the preceding one.
3. Draft the shortest direct Chinese that preserves the source's content and
   movement. Freely change word class, replace abstract noun phrases with
   concrete verbs, and remove wording that adds no meaning. Then split or
   locally reorder sentences inside the source paragraph if needed. Only if the
   passage remains unintelligible may you reconstruct its expression more
   freely. Preserve source paragraphs, examples, qualifications, and detail
   unless a specific obstacle justifies changing them.
4. Check relevant authorial witnesses. Keep this comparison backstage.
5. Run a meaning audit: core claims, logic, concepts, facts, figures, and
   quotations. Record a source-item argument map and bind the review to the
   exact draft hash.
6. Run a separate source-blind readability and continuity audit. Do not merely
   answer a checklist. For every Chinese prose paragraph, record a one-reading
   paraphrase, the relation between adjacent sentences, and a question the
   paragraph answers. Where the prose brackets differences or qualifications,
   identify the exact sentence that returns the reader to the common point.
   Rewrite anything a normal reader must decode twice because of the Chinese,
   any silent change of
   conceptual subject, and any paragraph that reads as a list rather than a line
   of reasoning. Do not fail a translation because the source makes a contested
   assumption, leaves a claim unproved, or postpones a question; the reader only
   needs to understand what move the source makes. Audit every changed paragraph
   boundary and reject changes made only for visual rhythm or shorter blocks.
   Replace any semicolon that merely compresses two sentences or imitates the
   source's long syntax. Apply a shorter-without-loss test to every paragraph:
   if plainer wording preserves the same source claim, prefer it over a more
   abstract or source-shaped formulation.
7. Reconcile the source-aware argument map with the source-blind reconstruction.
   If they differ, the Chinese has failed even when every individual sentence is
   grammatical. Reopen the task, revise the draft, and repeat both reviews.
8. Review translator notes for necessity, brevity, and clear attribution.
9. Assemble only approved chunks into a clean section or chapter candidate.
10. Before registering any candidate version, send only that assembled Chinese
    artifact to an independent reader context. Do not provide the source,
    intended argument map, prior reviews, user complaints, or expected fixes.
    Require a hash-bound `PASS` under `references/review-protocol.md`. A `FAIL`
    reopens the translation tasks; it never becomes a registered candidate.
11. Register the version only after the independent reader gate passes.

## Durable project work

Never rely on chat history for a multi-section project. The project directory is
the controller and source of truth.

When no project path is supplied, discover matching projects in the current
workspace before creating anything:

```powershell
python scripts/discover_projects.py . --require-one
```

Use the discovered project's recorded `skill_snapshot` controller. Resolve a
named logical chapter through `manifests/outline.json` and
`manifests/work-units.jsonl`; a logical chapter may span several controller
chapters.

Initialize a new project:

```powershell
python scripts/init_project.py <project-root> --project-id <id> --title <title>
```

Upgrade an existing project and create its durable manifests:

```powershell
python scripts/reader_project_controller.py migrate <project-root>
```

Recover the exact current state after a new task or context compaction:

```powershell
python scripts/reader_project_controller.py context <project-root>
```

Create bounded, self-contained chapter tasks:

```powershell
python scripts/reader_project_controller.py make-tasks <project-root> ch05 --max-paragraphs 5
```

Validate before resuming or releasing:

```powershell
python scripts/reader_project_controller.py validate <project-root>
```

Every task package must contain the exact source slice, source hash, standard
hash, output path, and acceptance checks. Save drafts and reviews to disk before
updating task status. Approved work is never silently overwritten; create a new
revision and append a decision or progress event.

Register and adopt reader versions, and rebuild the final one-file-per-chapter
output, only through the controller commands documented in
`references/project-operations.md`.
