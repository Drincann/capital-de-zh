# Cold start and project operations

Use this protocol for an existing multi-section translation project. The skill
defines the method; the project directory stores the actual source, decisions,
versions, status, and interface configuration.

All controller and project-state commands in this document are main-agent-only
operations. Delegated translators and reviewers may read their assigned inputs
and write drafts or review artifacts, but must not run controller, status,
validation, assembly, version, adoption, rebuild, or app commands. They report
artifact paths to the main agent, which performs the state transition. When
execution access is already sufficient, the main agent runs safe in-scope
commands directly without asking the user for conversational approval.

## 1. Find and resume the project

When the user says “开始翻译……” or “继续……” without giving a project path:

1. Search the current workspace with:

   ```powershell
   python <skill-root>/scripts/discover_projects.py . --require-one
   ```

2. If exactly one matching project exists, resume it. Never initialize a second
   project merely because the user did not repeat its path.
3. If several matching projects exist and the requested book or scope identifies
   one unambiguously, select it; otherwise ask which project to use.
4. If no matching project exists, initialize a project only when the request
   actually asks for a new project.
5. Read `project.json` and use its `skill_snapshot` controller, not an assumed
   version:

   In Codex Desktop, first load the workspace dependencies and use the bundled
   Python executable returned there. If `project.json` records
   `execution_policy.desktop_python`, prefer that executable while it exists.
   Do not fall back to a user-installed Python under
   `AppData/Local/Programs`; it sits outside the workspace runtime and can
   trigger redundant approval prompts even when project access is already
   allowed.

   ```powershell
   python <project-root>/<skill_snapshot>/scripts/reader_project_controller.py validate <project-root>
   python <project-root>/<skill_snapshot>/scripts/reader_project_controller.py context <project-root> --chapter <logical-chapter-id>
   ```

6. Read the returned work units, active specification, first pending task
   package, `next_actions`, relevant decisions, and latest events. Execute the
   first applicable recorded action instead of inferring a new workflow from an
   empty task list.

The workspace must contain or expose the project directory. A skill cannot
recover project files from another inaccessible workspace.

## 2. Execution ownership and approvals

- The coordinating main agent alone runs controller, status, validation,
  assembly, version, adoption, rebuild, and local-app commands.
- A delegated translator or reviewer receives only the inputs and output path
  needed for its artifact. It writes the artifact, reports the path, and stops.
- Do not place executable control-command blocks in delegated task packages or
  prompts.
- When the current task already has sufficient access, run safe commands within
  the user's requested scope directly. Do not ask for another verbal approval
  merely because a command performs a read-only check.
- A genuine platform permission prompt may still be required when the active
  task lacks access or an action crosses the user's authorized scope. Do not
  simulate such a prompt in prose.

## 3. Resolve what the user named

Use `manifests/outline.json` for the book's front-matter and part/chapter
structure, and `manifests/work-units.jsonl` for every translatable unit. Source
edition prefaces and afterwords must be planned as `front-matter` work units;
do not treat a translator's preface as their substitute. A logical chapter such as
`ch01` may be implemented by several controller chapters such as `ch01`,
`ch01s02`, `ch01s03`, and `ch01s04`. `context --chapter ch01` must return all of
them.

Controller-only section rows use the real chapter title in
`manifests/chapters.jsonl`. Their section title and order belong in
`work-units.jsonl`. This prevents assembled files from producing headings such
as “第五章 第二节……” followed immediately by “二、……”.

If the requested unit has verified source but no tasks, create tasks. If it has
pending tasks, resume the first pending task. If every task is approved but no
version exists, assemble and register a version. Do not redo approved work.

## 4. Register and adopt reader versions

After assembly, register an immutable version through the controller:

```powershell
python <controller> register-version <project-root> <unit-id> \
  --reader-review-path <independent-reader-review.md> \
  --summary "<short description>"
```

The independent reviewer must have seen only the assembled Chinese artifact.
The command rejects missing, stale, malformed, or failing reader reviews. After
the gate passes, it derives the version number, copies the assembled artifact to
`reader-edition/versions/`, records active approved task revisions and review
evidence, and appends a progress event.

The gate is finite. The controller assigns two returns to a short unit, three to
a medium unit, and at most four to a long unit. Use a fresh reader for the
initial review and each recheck, and save all attempts. If the final permitted
review still finds a blocking translation defect, do not make another repair
and do not pause a batch run. Register the exact candidate with
`--allow-unresolved-final` and a concise `--review-note`, then continue. The app
shows that note only on the affected version. Style suggestions never consume a
return and never block registration when the current wording is already clear.

If an assembled review finds a new blocker inside a source task that has reached
its controller-calculated final review-cycle attempt, the upstream task has no
legal repair left. Do not invent another revision or submit unchanged prose to
more readers merely to manufacture a final-attempt filename. Register the
current failed review with
`--allow-unresolved-final --upstream-budget-exhausted-task <task-id>` and a
precise issue note. The controller verifies that the named task belongs to the
unit and has exhausted its length-based budget.

A `needs_review` version must not be auto-adopted or released. A passing version
must not carry an issue note unless it contains a task that reached the bounded
third-round failure state. In that case version registration automatically
copies the unresolved task IDs and their issue notes into the version and keeps
the version itself at `needs_review`, even if the assembled Chinese-only review
passes.

Adopt a reviewed version through:

```powershell
python <controller> adopt-version <project-root> <unit-id> <version-id>
```

Adoption changes only the pointer in `manifests/adoptions.json`. Never edit an
older registered version to represent a new wording; create a new task revision
and version. Correcting non-textual display code does not create a translation
version.

## 5. Build the one-file-per-chapter reader edition

After every section of a logical chapter has an adopted version, run:

```powershell
python <controller> rebuild-chapter <project-root> <logical-chapter-id>
```

The command reads adopted section versions in order, removes duplicate chapter
headings, and writes one clean Markdown file to the chapter's reader-facing
output path. Do not concatenate files by hand.

## 6. Local progress interface

If `project.json` contains `interfaces.progress_app`, treat that entry as the
authoritative path and URL. A running app should read project manifests live, so
normal translation updates require no cloud synchronization.

After changing the app itself, or before handing off a milestone, run every
command listed in `interfaces.progress_app.verify_commands` from the configured
app path. Do not hardcode a workspace-specific app path in the reusable skill.

## 7. Stop and hand off

Before ending a work turn:

1. save every draft and review before advancing status;
2. if a review changes the draft, reopen the task and rerun both reviews; never
   attach a stale meaning review to revised prose, and never exceed the
   controller-calculated return budget;
3. append progress through controller commands;
4. run project validation;
5. confirm any registered/adopted version and reader-facing chapter file;
6. confirm the progress interface can read the new state when configured;
7. report exact artifacts and the next pending unit. In an unattended batch,
   record unresolved final-review findings on their versions instead of pausing.

## 8. Optional chapter deployment checkpoint

When an approved project decision requires a preview deployment after each
logical chapter, treat the outline chapter rather than a controller subsection
as the checkpoint. Deploy only after every work unit belonging to that logical
chapter has an adopted version. Sync the preview data,
run its production build, and use the existing Sites project configuration.
Record the logical chapter, included translation version IDs, deployment time,
and deployed URL in a project manifest. Do not deploy after every subsection,
and do not create a second Sites project for later chapters.
