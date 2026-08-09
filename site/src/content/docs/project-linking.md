---
title: Project linking and IDEAS.md
description: Mirror a vault idea into a project, handle an existing IDEAS.md safely, understand Git behavior, and unlink without losing the canonical note.
section: projects
order: 10
status: shipped
appliesTo: desktop
lastReviewed: "2026-08-09"
sources:
  - app/src/components/ProjectLink.tsx
  - app/src-tauri/src/project.rs
  - app/src-tauri/src/lib.rs
related:
  - ideas-md-for-llms
  - ideas
  - privacy
searchTerms:
  - ideas.md
  - link project
  - gitignore
  - coding agent
  - project mirror
---

Link an idea to a software project and sudonotes keeps a predictable Markdown mirror at the project
root. The idea stays searchable and backed up in the vault while a local coding agent can discover
the context beside the code.

<div class="callout">
  <strong class="callout-title"><code>IDEAS.md</code> is a sudonotes convention, not an industry standard.</strong>
  The app always uses uppercase <code>IDEAS.md</code>. “ideas.md” is only a casual way people may
  refer to it on case-insensitive systems.
</div>

## The canonical and mirror copies

<div class="flow-diagram" aria-label="Project idea storage flow">
  <div class="flow-node"><strong>Vault idea</strong><span>Canonical `ideas/*.md`, search and backups</span></div>
  <div class="arrow" aria-hidden="true">→</div>
  <div class="flow-node"><strong>Project mirror</strong><span>Local, gitignored `IDEAS.md`</span></div>
  <div class="arrow" aria-hidden="true">→</div>
  <div class="flow-node"><strong>Local agent</strong><span>Reads it only with project access</span></div>
</div>

The vault note is canonical. Every later save tries to rewrite the project mirror. If a linked
folder goes missing or becomes unwritable, that mirror update is best-effort and does not prevent
the vault note itself from saving.

## Link an idea

1. Open an idea in the desktop app.
2. In the **Project** panel, choose **Choose project folder…**.
3. Select the project root—the folder that contains `.git`, the project README, or source folders.
4. Confirm the project card and the `IDEAS.md` message.

The idea title changes to the selected folder name so its sidebar group matches the project.
sudonotes records the absolute project path in the note’s frontmatter and writes the complete note,
including frontmatter, to `IDEAS.md`.

```text
weather-station/
├── .git/
├── .gitignore       # gains a sudonotes IDEAS.md entry
├── IDEAS.md         # mirror managed by sudonotes
├── README.md
└── src/
```

## Git behavior

When the folder is a Git repository, sudonotes appends a small labelled `IDEAS.md` entry to
`.gitignore` unless `IDEAS.md` or `/IDEAS.md` is already listed. It does not rewrite existing ignore
rules. A non-Git folder without a `.gitignore` receives the mirror but no new ignore file.

The ignore keeps private working context available locally without putting it in a normal commit.
You can deliberately remove the rule and commit the mirror, but inspect both body and frontmatter
first: they may contain private ideas and the absolute local project path.

## If IDEAS.md already exists

sudonotes stops before overwriting the file and offers three paths:

- **Use the existing file** imports its Markdown body into the vault idea, links the project, and
  rewrites the mirror with sudonotes frontmatter.
- **Replace it with this note** overwrites the project file with the open vault idea.
- **Cancel** leaves both files unchanged.

Use the existing file when it contains project context you need to preserve. Before replacing it,
open the file in an editor or copy it elsewhere if there is any uncertainty.

## Change or unlink a project

Use **Change** to select another folder. The new link follows the same conflict checks.

- **Unlink** clears the project path and stops future mirroring. The current `IDEAS.md` stays in the
  old project.
- **Unlink & delete** also removes that project mirror.

The `.gitignore` entry stays in place in both cases so a future file is not committed by surprise.
Remove the line manually only when you are sure the project no longer uses the convention.

## Missing or unwritable folders

If the linked project moved, the Project card marks it missing. Use **Change** to point at the new
root. The vault note remains editable meanwhile.

An initial link must be able to create `IDEAS.md`; otherwise the app shows an error and does not
pretend the link succeeded. Check that the folder exists, is a directory, and is writable.

## Local and remote LLM visibility

Project linking does not send a note to an LLM and does not start implementation. It makes the
Markdown discoverable to a local agent that has access to that project folder. A remote chat or
cloud agent cannot see a gitignored local file unless you upload it or explicitly provide access to
the working folder.

For a reliable handoff, tell the agent to read `IDEAS.md`, inspect the repository, and treat the
file’s constraints as project context. The [LLM-oriented guide](/docs/ideas-md-for-llms) provides a
template and safe handoff examples.
