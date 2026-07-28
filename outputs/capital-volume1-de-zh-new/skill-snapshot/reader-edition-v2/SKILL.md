---
name: translate-capital-de-zh
description: Create a plain-language modern-Chinese reader's edition of Karl Marx's Capital from verified German text, prioritizing one-read comprehension for high-school and undergraduate readers while preserving the core argument. Use for direct German-to-Chinese translation, reader-first rewriting, source acquisition, edition comparison, inline translator notes, readability QA, sample chapters, or durable chapter/book-scale translation projects. Do not use merely to modernize an existing Chinese translation or to create a separate reading guide.
---

# Translate Capital into a Plain-Chinese Reader's Edition

Create a new Chinese reader's edition from the German source. The final book is
for ordinary educated readers, not specialists. Make Marx's argument directly
understandable in the main text instead of asking the reader to decode German
syntax, inherited translationese, or an academic apparatus.

This is an editorial translation, not a line-by-line crib. Sentence structure,
paragraphing, repetitions, metaphors, and minor detail may be changed when they
obstruct comprehension. Never reverse a claim, alter a causal or conditional
relation, merge key conceptual distinctions, invent evidence, or present the
translator's interpretation as Marx's uncontested statement.

## Read the required references

- Before selecting or extracting sources, read
  [references/edition-policy.md](references/edition-policy.md) completely.
- Before drafting or reviewing any translation, read
  [references/translation-standard.md](references/translation-standard.md)
  completely.
- For work longer than one passage, read
  [references/project-schema.md](references/project-schema.md) completely.

## Reader-facing contract

- Target a reader with high-school or undergraduate education and no prior
  economics or philosophy training.
- Write natural present-day Chinese with explicit subjects, short sentences, and
  visible logical connections.
- Translate the meaning and argumentative function, not the German word order.
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
2. Parse each source paragraph for its core claim, logical relations, examples,
   key contrasts, and likely reader misunderstandings.
3. Draft the shortest natural Chinese that lets a new reader follow the argument.
   Split, merge, reorder, name implicit subjects, and unpack compressed reasoning
   as needed.
4. Check relevant authorial witnesses. Keep this comparison backstage.
5. Run a meaning audit: core claims, logic, concepts, facts, figures, and
   quotations.
6. Run a source-blind readability audit. Rewrite anything a normal reader must
   decode twice.
7. Review translator notes for necessity, brevity, and clear attribution.
8. Assemble only approved chunks into the clean chapter Markdown.

## Durable project work

Never rely on chat history for a multi-section project. The project directory is
the controller and source of truth.

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

