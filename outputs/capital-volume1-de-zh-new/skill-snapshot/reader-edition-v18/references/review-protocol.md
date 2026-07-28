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

For each task, permit at most two returns for automatic revision: initial review,
first revision and recheck, then second revision and final recheck. Save the
three attempts with `-r1`, `-r2`, and `-r3` in their filenames. Task-level
meaning and readability defects must be resolved before assembly. Do not turn
style suggestions into an endless optimization loop.

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
make one repair and run a fresh blind recheck. If that fails, make a second and
final repair followed by one last fresh recheck. Save the attempts as
`<unit>-independent-r1.md`, `-r2.md`, and `-r3.md`. A third blocking failure
never triggers a third repair and does not pause batch translation. Register the
exact final candidate as `needs_review`, attach a concise summary of the
remaining T findings to that version, and continue to the next unit. Do not
auto-adopt or release it. Register a passing version normally and do not create
or display an issue summary for it.

The controller validates the fields, headings, artifact hash, review attempt,
verdict, and required issue summary before version registration. It cannot prove
that the reviewer was independent, so the orchestrator must create a fresh
context and withhold the prohibited material.
