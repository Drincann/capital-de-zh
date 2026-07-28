# Durable reader's-edition project schema

Use this schema for any task longer than a single passage. Its purpose is to make
the work resumable after context compaction, a new Codex task, or a different
agent. Chat history is never the source of truth.

## 1. Directory layout

```text
project-root/
  project.json
  PROJECT.md
  spec/
    reader-edition-standard.md
    workflow.md
    release-policy.md
  sources/
    source-manifest.jsonl
    raw/
    facsimiles/
    normalized/
  chapters/
    ch05/
      source/
        de-1890.txt
        fr-1872-1875.txt
      tasks/
      drafts/
      reviews/
      alignment.jsonl
      variants.jsonl
      decisions.jsonl
      status.json
  reader-edition/
    第五章 劳动过程和价值增殖过程.md
  decisions/
    translation-decisions.jsonl
    terminology.tsv
  manifests/
    chapters.jsonl
    tasks.jsonl
    unit-versions.jsonl
    unit-version-reviews.jsonl
    adoptions.json
    releases.jsonl
  progress/
    events.jsonl
  skill-snapshot/
```

`reader-edition/` is the only reader-facing tree. Everything else is backstage.
Keep source, tasks, drafts, reviews, and decisions even after release.

## 2. Project and specification lock

`project.json` must record:

- project identity, title, scope, and project type;
- target reader and final format;
- base edition and witnesses;
- reader-edition standard version;
- status, creation time, and last update time.
- execution constraints such as local-only storage and whether paid external
  APIs are prohibited;
- optional local interfaces and their paths relative to the project root.

At every task creation, hash:

- the exact source slice;
- all active files in `spec/`;
- the current skill snapshot.

A completed task whose source or specification hash has changed is stale. Do not
silently reuse or overwrite it.

## 3. Chapter manifest and state machine

Each `manifests/chapters.jsonl` row contains:

```json
{
  "chapter_id": "ch05",
  "title_zh": "第五章 劳动过程和价值增殖过程",
  "source_path": "chapters/ch05/source/de-1890.txt",
  "source_sha256": "",
  "status": "source_locked",
  "output_path": "reader-edition/第五章 劳动过程和价值增殖过程.md",
  "last_updated": "ISO-8601"
}
```

Valid chapter states, in order:

```text
source_locked
chunked
drafted
meaning_reviewed
readability_reviewed
assembled
user_approved
released
```

Advancing a chapter requires the preceding artifact or review gate. Revisions
after `user_approved` create a new revision; they do not overwrite the approved
release silently.

## 4. Bounded task manifest

Each `manifests/tasks.jsonl` row contains:

```json
{
  "task_id": "ch05-p0001-p0005-r1",
  "chapter_id": "ch05",
  "start_paragraph": "v1-ch05-s01-p0001",
  "end_paragraph": "v1-ch05-s01-p0005",
  "task_package_path": "chapters/ch05/tasks/ch05-p0001-p0005-r1.md",
  "base_source_path": "chapters/ch05/source/de-1890.txt",
  "source_sha256": "",
  "spec_sha256": "",
  "status": "pending",
  "artifact_path": "chapters/ch05/drafts/ch05-p0001-p0005-r1.md",
  "artifact_sha256": "",
  "meaning_review_path": "",
  "readability_review_path": "",
  "dependencies": [],
  "revision": 1,
  "last_updated": "ISO-8601"
}
```

Valid task states:

```text
pending
in_progress
drafted
meaning_reviewed
readability_reviewed
approved
superseded
```

Default task size is five source paragraphs. Reduce it when paragraphs are long.
A task package is self-contained: exact source, hashes, target output path,
reader standard, relevant decisions, and acceptance checks.

## 5. Task package contract

Every task Markdown file must include:

1. task and chapter IDs;
2. source and specification hashes;
3. exact source paragraph range;
4. output path;
5. the reader-facing rules needed to do the work;
6. relevant terminology and prior decisions;
7. exact German source text;
8. required review and completion commands.

The translator writes only the reader-facing Chinese body to the draft artifact.
No paragraph IDs or work notes go into that body.

## 6. Reviews

Meaning review checks the draft against the source for core claims, logic,
conceptual distinctions, facts, and unjustified additions. It is bound to the
exact draft SHA-256 and contains a non-empty argument-map entry for every source
item.

Readability review is source-blind first. It checks whether an ordinary new reader
can understand the paragraph once, identify the actor and action, and explain the
reasoning. It contains paragraph-by-paragraph paraphrases, reader questions,
sentence-transition evidence, scope-and-closure evidence, and a second-read risk
audit. Findings are classified as translation obstacles, authorial difficulties,
or questions deferred by the source. Only translation obstacles fail the draft;
the review does not require the translation to prove, defend, or complete the
source's theory. Any revision invalidates both reviews and returns the task to
`drafted`.

Translator-note review checks necessity, brevity, placement, and attribution.

Each review is saved under `chapters/<id>/reviews/` before status is advanced.
The controller validates the review type, verdict, task ID, draft hash, required
headings, and paragraph/source-item coverage. File existence alone is not a
review gate.

## 7. Progress and decisions

Append a progress event after every durable action:

```json
{
  "time": "ISO-8601",
  "chapter": "ch05",
  "task_id": "ch05-p0001-p0005-r1",
  "stage": "draft",
  "artifact": "chapters/ch05/drafts/ch05-p0001-p0005-r1.md",
  "result": "completed",
  "next": "meaning-review"
}
```

Never edit an approved global decision silently. Append a superseding decision
with a link to the earlier ID. Use chapter-local decisions for one-off choices and
the global log for recurring policy.

## 8. Recovery protocol

At the start of every new or compacted task:

1. if no project path was supplied, run `scripts/discover_projects.py` from the
   current workspace and resume the one matching project;
2. read `project.json` and use the controller under its recorded
   `skill_snapshot`;
3. run the controller's `validate` command;
4. run its `context --chapter <logical-chapter-id>` command;
5. read `project.json` and the active files in `spec/`;
6. read the returned controller chapters, work units, versions, adoptions, and
   last twenty progress events;
7. read only the first pending task package and its relevant decisions;
8. verify source and specification hashes before drafting;
9. continue from the recorded state, not from memory.

This sequence is mandatory even when the agent believes it remembers the project.

## 9. Release

Assembly accepts only approved tasks whose paragraph ranges cover the chapter
without gaps or overlap and whose artifact hashes still match. The controller
creates the chapter Markdown under `reader-edition/` and records a release row
with its SHA-256.

Before marking `released`, require:

- successful project validation;
- full paragraph coverage;
- meaning and readability approval;
- clean Markdown with no internal IDs or task markers;
- explicit user approval for the edition's style or the chapter.

## 10. Reader versions and adoption

Keep assembled reader versions immutable. Register each one in
`manifests/unit-versions.jsonl`:

```json
{
  "version_id": "ch05-s01-v2",
  "unit_id": "ch05-s01",
  "number": 2,
  "artifact_path": "reader-edition/versions/ch05-s01-v2.md",
  "created_at": "ISO-8601",
  "source_task_revisions": ["ch05-p0001-p0005-r2"],
  "summary": "Argument-continuity revision"
}
```

`manifests/adoptions.json` maps each work unit to the version currently adopted
by the reader:

```json
{
  "ch05-s01": "ch05-s01-v2"
}
```

Adoption is a pointer, not a destructive status change. Changing it must not
rewrite or delete any version artifact. A local reading application may update
this file only after validating that the selected version belongs to the unit.
The canonical chapter Markdown should be rebuilt from the adopted section
versions rather than treated as the version archive itself.

Every newly registered version must have an independent-reader `PASS` bound to
the exact assembled artifact hash. `PASS` means the Chinese communicates the
source's moves without translation-induced ambiguity; it does not certify that
the argument is true or fully proved. The review is recorded in
`manifests/unit-version-reviews.jsonl` and copied into the version row. A failed
blind review is recorded for diagnosis but cannot authorize registration.

Use controller commands instead of editing these manifests by hand:

```powershell
python <controller> register-version <project-root> <unit-id> \
  --reader-review-path <independent-review.md> --summary "..."
python <controller> adopt-version <project-root> <unit-id> <version-id>
python <controller> rebuild-chapter <project-root> <logical-chapter-id>
```

When a logical chapter is split into several controller chapters, every
controller row uses the real chapter title. Section titles and ordering live in
`work-units.jsonl`. This keeps the assembled Markdown hierarchy consistent.

## 11. Optional local interfaces

Record project-specific local tools in `project.json`, not in chat history or a
hardcoded reusable skill path:

```json
{
  "interfaces": {
    "progress_app": {
      "path": "../../capital-progress-app",
      "url": "http://127.0.0.1:4173/",
      "live_state": true,
      "verify_commands": ["npm run sync", "npm test", "npm run build"]
    }
  }
}
```

Resolve `path` relative to the project root. A live-state app reads the manifests
directly; run its verification commands after changing the app or before a
milestone handoff.
