# Persistent project schema

Use this schema for any task longer than a single passage.

## Directory layout

```text
project-root/
  project.json
  PROJECT.md
  sources/
    source-manifest.jsonl
    raw/
    facsimiles/
    normalized/
  chapters/
    ch01/
      source/
        de-1890.txt
        fr-1872-1875.txt
        de-1872.txt
        de-1867.txt
      alignment.jsonl
      variants.jsonl
      translation-draft.md
      translation-approved.md
      qa.json
  decisions/
    translation-decisions.jsonl
    terminology.tsv
  progress/
    events.jsonl
  skill-snapshot/
```

Create chapter directories only when work begins. Keep the exact source passage
beside its translation. Never place source and translation only in a chat.

## Stable paragraph IDs

Use:

```text
v1-ch01-p0001
```

For split source paragraphs, append `a`, `b`, and so on. IDs never change after an
approved translation cites them.

## Source manifest

Each JSONL row contains:

```json
{
  "source_id": "de-1890",
  "role": "base",
  "language": "de",
  "edition": "German fourth edition",
  "year": "1890",
  "authority": "MEGA II/10",
  "item_url": "https://...",
  "text_url": "https://...",
  "facsimile_url": "https://...",
  "local_path": "",
  "sha256": "",
  "bytes": 0,
  "status": "candidate",
  "verified": false,
  "notes": ""
}
```

Valid status values:

- `candidate`
- `downloaded-unverified`
- `search-aid-only`
- `edition-verified`
- `passage-verified`
- `rejected`

## Alignment rows

```json
{
  "paragraph_id": "v1-ch01-p0001",
  "base_locator": "de-1890:p1",
  "witnesses": {
    "fr-1872-1875": ["fr:p1"],
    "de-1872": ["de2:p1"],
    "de-1867": ["de1:p1"]
  },
  "relation": "aligned",
  "notes": ""
}
```

Do not force alignment. Use `absent`, `split`, `joined`, `moved`, or `uncertain`
when needed.

## Variant rows

```json
{
  "paragraph_id": "v1-ch01-p0001",
  "witness": "fr-1872-1875",
  "class": "CLAR",
  "base_excerpt": "",
  "witness_excerpt": "",
  "effect": "",
  "decision_id": ""
}
```

## Translation decisions

```json
{
  "decision_id": "D0001",
  "date": "YYYY-MM-DD",
  "scope": "v1-ch01-p0001",
  "issue": "",
  "decision": "",
  "basis": ["de-1890", "fr-1872-1875"],
  "status": "approved"
}
```

Never revise an approved decision silently. Append a superseding decision and
reference the prior ID.

## Progress events

Append a row after every durable unit of work:

```json
{
  "time": "ISO-8601",
  "chapter": "ch01",
  "stage": "draft",
  "through": "v1-ch01-p0020",
  "artifact": "chapters/ch01/translation-draft.md",
  "result": "completed",
  "next": "semantic-audit"
}
```

On resumption:

1. read `project.json`;
2. verify the skill snapshot or current skill version;
3. read the source manifest;
4. read the last progress event;
5. load only the decisions and terminology relevant to the next passage;
6. validate the project;
7. continue from the recorded `next` stage.
