# Workflow

This project is controlled by files, not chat memory.

## Chapter pipeline

`source_locked -> chunked -> drafted -> meaning_reviewed ->
readability_reviewed -> assembled -> user_approved -> released`

## Task pipeline

`pending -> in_progress -> drafted -> meaning_reviewed ->
readability_reviewed -> approved`

1. Run `validate` and `context` whenever work resumes.
2. Open only the next pending task package and the active specification.
3. Write reader-facing Chinese only to the task's draft artifact.
4. Save meaning and readability reviews as separate Markdown files. Each review
   must contain the required evidence and exact draft hash.
5. Update task status only after the controller validates the review content,
   not merely the file's existence.
6. Assemble a chapter only from approved tasks with unchanged hashes.
7. Before registering a candidate version, require a hash-bound review from an
   independent reader context that saw only the assembled Chinese. The reader
   tests translation clarity, not whether the source has proved its theory.
   The return budget is based on the work unit's source length: two for a short
   unit, three for a medium unit, and at most four for a long unit. Style
   suggestions do not fail it. A blocking FAIL on the final permitted attempt
   registers the exact candidate as `needs_review`, attaches a concise issue
   note, and does not pause the batch.
8. Never overwrite an approved release silently. Create a new task revision and
   append a progress event and decision.
