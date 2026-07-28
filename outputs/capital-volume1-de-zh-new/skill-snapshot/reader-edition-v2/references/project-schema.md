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
conceptual distinctions, facts, and unjustified additions.

Readability review is source-blind first. It checks whether an ordinary new reader
can understand the paragraph once, identify the actor and action, and explain the
reasoning. Any revision then returns through meaning review.

Translator-note review checks necessity, brevity, placement, and attribution.

Each review is saved under `chapters/<id>/reviews/` before status is advanced.

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

1. run the controller's `validate` command;
2. run its `context` command;
3. read `project.json` and the active files in `spec/`;
4. read the chapter manifest row and the last twenty progress events;
5. read only the pending task package and its relevant decisions;
6. verify source and specification hashes before drafting;
7. continue from the recorded state, not from memory.

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
