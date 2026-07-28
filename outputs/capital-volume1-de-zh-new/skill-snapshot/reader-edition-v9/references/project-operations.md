# Cold start and project operations

Use this protocol for an existing multi-section translation project. The skill
defines the method; the project directory stores the actual source, decisions,
versions, status, and interface configuration.

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

   ```powershell
   python <project-root>/<skill_snapshot>/scripts/reader_project_controller.py validate <project-root>
   python <project-root>/<skill_snapshot>/scripts/reader_project_controller.py context <project-root> --chapter <logical-chapter-id>
   ```

6. Read the returned work units, active specification, first pending task
   package, relevant decisions, and latest events. Continue from those files.

The workspace must contain or expose the project directory. A skill cannot
recover project files from another inaccessible workspace.

## 2. Resolve what the user named

Use `manifests/outline.json` for the book's part/chapter structure and
`manifests/work-units.jsonl` for section-level work. A logical chapter such as
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

## 3. Register and adopt reader versions

After assembly, register an immutable version through the controller:

```powershell
python <controller> register-version <project-root> <unit-id> \
  --summary "<short description>"
```

The command derives the version number, copies the assembled artifact to
`reader-edition/versions/`, records active approved task revisions, and appends a
progress event.

Adopt a reviewed version through:

```powershell
python <controller> adopt-version <project-root> <unit-id> <version-id>
```

Adoption changes only the pointer in `manifests/adoptions.json`. Never edit an
older registered version to represent a new wording; create a new task revision
and version. Correcting non-textual display code does not create a translation
version.

## 4. Build the one-file-per-chapter reader edition

After every section of a logical chapter has an adopted version, run:

```powershell
python <controller> rebuild-chapter <project-root> <logical-chapter-id>
```

The command reads adopted section versions in order, removes duplicate chapter
headings, and writes one clean Markdown file to the chapter's reader-facing
output path. Do not concatenate files by hand.

## 5. Local progress interface

If `project.json` contains `interfaces.progress_app`, treat that entry as the
authoritative path and URL. A running app should read project manifests live, so
normal translation updates require no cloud synchronization.

After changing the app itself, or before handing off a milestone, run every
command listed in `interfaces.progress_app.verify_commands` from the configured
app path. Do not hardcode a workspace-specific app path in the reusable skill.

## 6. Stop and hand off

Before ending a work turn:

1. save every draft and review before advancing status;
2. append progress through controller commands;
3. run project validation;
4. confirm any registered/adopted version and reader-facing chapter file;
5. confirm the progress interface can read the new state when configured;
6. report exact artifacts and the next pending unit.
