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
   If the paragraph's apparent structure differs from the source structure,
   reject the draft.

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
  disguised as arguments, and sentences whose purpose becomes clear only at the
  end of the paragraph.
- Under `Paragraph and punctuation audit`, record all source-boundary changes
  and the semicolon count.

## 4. Failure and revision

Any of the following forces `Verdict: FAIL`:

- the reader paraphrase cannot state why the paragraph exists;
- adjacent sentences are individually clear but their relation is supplied by
  the reviewer rather than signalled by the Chinese;
- an exclusion or qualification does not return to the common point;
- the source-aware and source-blind argument maps disagree;
- a term, pronoun, abstraction, or grammatical structure requires rereading;
- the review contains placeholders, empty evidence, or generic praise.

Do not advance a failed task. Revise the draft, reopen its review cycle, and bind
both new reviews to the new draft hash.

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
place where it had to reread, infer an unstated bridge, guess a comparison
object, or rely on specialist knowledge. Any such unresolved obstacle forces
`Verdict: FAIL`.

The controller validates the fields, headings, artifact hash, and verdict before
version registration. It cannot prove that the reviewer was independent, so the
orchestrator must create a fresh context and withhold the prohibited material.
