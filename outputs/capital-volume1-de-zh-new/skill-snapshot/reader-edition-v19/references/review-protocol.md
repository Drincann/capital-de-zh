# Evidence-based review protocol

The project controller can verify hashes, coverage, and review evidence. It
cannot decide by itself whether prose is genuinely easy to understand. The
semantic judgment remains model-driven, so a review must expose the reasoning
that led to a pass. A bare checklist or an unsupported “通过” is invalid.

## 1. Review separation

Run two different passes.

1. The meaning review reads the German source and the Chinese draft. It records
   the source argument map and checks fidelity.
2. The readability review starts from the Chinese draft alone. Reconstruct what
   the Chinese actually communicates before consulting the source-aware review.
3. Compare the two reconstructions only after the source-blind pass is written.
   Reject the draft only when they differ materially in claim, relation, scope,
   referent, or conceptual distinction. Different wording, paragraphing, or a
   clearer local order is expected.

The readability pass tests communication, not theoretical validity. A reader may
understand an inference and still think it is unproved. That is not a translation
failure.

Use an independent reviewer context when one is available. When it is not,
perform the source-blind pass as a separate operation and do not use intended
meaning to repair an unstated relation.

## 2. Meaning review evidence

Use these exact machine-readable fields:

```text
Review-Type: meaning
Task-ID: <task id>
Draft-SHA256: <64 lowercase hexadecimal characters>
Verdict: PASS
```

Include these exact headings:

```markdown
## Source argument map
## Claim and logic audit
## Changes and uncertainty
```

Under `Source argument map`, include one non-empty bullet for every source item:

```text
- [v1-ch01-s01-p0002]: main claim ...; steps ...
```

Do not pass a draft with an omission, logical change, unsupported addition, or
unresolved uncertainty.

## 3. Source-blind readability evidence

Use these exact machine-readable fields:

```text
Review-Type: readability
Task-ID: <task id>
Source-Blind: YES
Draft-SHA256: <64 lowercase hexadecimal characters>
Verdict: PASS
```

Include these exact headings:

```markdown
## One-read paraphrases
## Reader questions
## Transition evidence
## Scope and closure audit
## Second-read risks
## Paragraph and punctuation audit
```

Number every Chinese prose paragraph `C1`, `C2`, and so on. Headings and
standalone formulas are not prose paragraphs.

- Under `One-read paraphrases`, write one non-empty `- Cn:` bullet per prose
  paragraph. State its point as a single continuous thought.
- Under `Reader questions`, write one `- Cn Q: ... A: ...` bullet per prose
  paragraph. The answer must be available from the Chinese without source
  knowledge.
- Under `Transition evidence`, list every adjacent sentence pair in every
  multi-sentence paragraph, for example:
  `- C2: S1->S2=definition, signal=“就是”; S2->S3=qualification,
  signal=“不过”`. A relation may be marked `self-evident`, but do not use that
  label to excuse a missing conceptual bridge.
- For every explicit connector, quote or closely paraphrase the complete
  proposition on each side and record the relation the connector asserts. For
  `但`, `但是`, `不过`, `可是`, `却`, `然而`, and concessive pairs, also record
  the expectation licensed by the first proposition and exactly how the second
  denies, limits, or corrects it. A paragraph-level contrast cannot validate a
  locally false connector. Apply the same proposition-pair check to causal,
  inferential, additive, sequential, and restatement connectors.
- End `Transition evidence` with one machine-visible summary line beginning
  `- Connector-Pairs:`. List every `Cn` paragraph containing an explicit
  connector and give its connector plus proposition-pair judgment; write
  `- Connector-Pairs: none` only when the draft contains none. This summary is
  required for work created under reader-edition standard v19 or later.
- Under `Scope and closure audit`, inspect every paragraph that brackets,
  excludes, postpones, or abstracts from differences. Record
  `scope=... | invariant=... | anchor=...`. The `anchor` must quote exact words
  in the Chinese that return the reader to the common point. If there are no such
  paragraphs, write `- None.`
- Under `Second-read risks`, write `- None in current draft.` only after testing
  vague referents, hidden changes of subject, unexplained abstractions, lists
  disguised as arguments, sentences whose purpose becomes clear only at the end
  of the paragraph, and source-shaped abstract wording that preserves no meaning
  beyond a shorter ordinary-Chinese alternative.
- The second-read audit must separately test first-use relational terminology.
  When a term names a role, position, direction, comparison basis, or function,
  record the concrete bearer and action available to a first-time reader at the
  point of introduction. If the reader can identify them only after reading
  later paragraphs and backtracking, classify the problem as `T`.
- End `Second-read risks` with one machine-visible summary line beginning
  `- Relational-First-Use:`. List the first-use terms tested and their concrete
  bearer/function mapping, or state that the draft introduces no relational
  term. This summary is required for work created under reader-edition standard
  v19 or later.
- Classify every finding as `T` (blocking translation defect), `S` (style
  suggestion), `A` (authorial difficulty), or `D` (question deferred by the
  source). Only unresolved `T` findings block a pass. A source-blind reviewer
  who cannot classify a finding must flag it for the later source-aware
  comparison rather than demand an explanatory rewrite.
- Under `Paragraph and punctuation audit`, record all source-boundary changes
  and the semicolon count.

## 4. Failure and revision

Any of the following forces `Verdict: FAIL` when it materially prevents or
distorts an ordinary undergraduate's understanding:

- the reader paraphrase cannot state why the paragraph exists;
- adjacent sentences are individually clear but their relation is supplied by
  the reviewer rather than signalled by the Chinese;
- an exclusion or qualification does not return to the common point;
- a relational term is named before the current example makes its concrete
  bearer and function recoverable, so the reader must learn what the term meant
  only from later prose;
- an explicit connector asserts a contrast, cause, inference, addition,
  sequence, or restatement that its bounded proposition pair does not support;
  use the propositions immediately around it by default, but allow a
  paragraph-initial connector to govern a precisely quoted, clearly
  recoverable cluster in the preceding paragraph; a vague distant or
  chapter-wide contrast still cannot rescue a false `但是` or `不过`;
- the source-aware and source-blind argument maps disagree about a claim,
  relation, scope, referent, comparison, or indispensable distinction;
- a term, pronoun, abstraction, comparison, or grammatical structure makes the
  main move genuinely ambiguous or unrecoverable;
- the Chinese states a different claim, omits an argument-bearing step, or adds
  an unsupported claim;
- the review contains placeholders, empty evidence, or generic praise.

The following do not force failure when the Chinese makes their status clear:

- another valid wording is shorter, smoother, more concrete, or preferred by the
  reviewer;
- a sentence is not the reviewer's personal stylistic choice but can be
  understood correctly without backtracking;
- Chinese paragraph boundaries differ from the source while coverage and logic
  remain intact;
- the reader doubts a premise or wants a fuller proof;
- the source chooses an analytical abstraction the reader does not accept;
- a later section must explain a relation more fully;
- a historically or theoretically difficult idea remains difficult after being
  stated in ordinary Chinese.

Record non-blocking alternatives as `S`; they are editorial options, not orders
to revise. The review is a safety gate, not an optimization contest.

For each task, use the controller's source-length budget: two returns for a
short unit, three for a medium unit, and four for a long unit. Including the
initial review, the final attempt is therefore review-cycle attempt 3, 4, or 5.
Keep artifact filenames tied to their actual revision number. If the final
source-aware meaning review or source-blind readability review still finds a
blocking defect, preserve that exact draft as `needs_review` and record the
remaining findings in its task-level issue summary. A later review stage may
still run, but a later `PASS` does not erase an earlier unresolved final
finding. Do not turn style suggestions into an endless optimization loop.

## 5. Mandatory independent reader gate

Task-level self-review is not sufficient for an assembled section or chapter.
Before registering a candidate version, give only the assembled Chinese file to
a fresh reader context. Do not provide German, old translations, argument maps,
user feedback, known failure points, or expected wording.

The independent report must use:

```text
Review-Type: independent-reader
Unit-ID: <work unit id>
Artifact-SHA256: <assembled file hash>
Reviewer-Context: <fresh agent or task identifier>
Source-Access: NO
Verdict: PASS
```

It must contain:

```markdown
## Overall assessment
## Paragraph findings
## Failure probes
```

The reviewer tests every paragraph for one-reading comprehension and reports any
place where the Chinese materially obscures the main move, leaves a required
bridge unstated, makes a referent or comparison object ambiguous, or depends on
unexplained specialist vocabulary. The reviewer does not judge whether the
source has proved its claim. Questions about truth, proof, or later theory may
be reported as `A` or `D`; optional wording improvements are `S`. None of these
forces failure. Only unresolved `T` defects force `Verdict: FAIL`.

The independent gate is also bounded. Run an initial blind review. If it fails,
make repairs only within the unit's two-, three-, or four-return budget, using a
fresh blind reader after every change. Save attempts as
`<unit>-independent-r1.md` through the controller-calculated final attempt
(`r3`, `r4`, or `r5`). A blocking failure on that final attempt never triggers
another repair and does not pause batch translation. Register the exact final
candidate as `needs_review`, attach a concise summary of the remaining T
findings to that version, and continue to the next unit. Do not auto-adopt or
release it. Register a passing version normally and do not create or display an
issue summary for it, except when one of its source tasks already
ended as `needs_review`. A passing assembled review does not erase that
source-aware or task-level unresolved state; the version inherits the affected
task IDs and issue notes.

If this assembled review finds a new blocker that can only be repaired by
creating another revision for a task whose length-based return budget is already
exhausted, stop at the actual assembled-review attempt. Preserve its real
filename and attempt number, name the exhausted upstream task during version
registration, and mark the unit `needs_review`. Do not conduct fake repeat
reviews of unchanged prose.

The controller validates the fields, headings, artifact hash, review attempt,
verdict, and required issue summary before version registration. It cannot prove
that the reviewer was independent, so the orchestrator must create a fresh
context and withhold the prohibited material.
