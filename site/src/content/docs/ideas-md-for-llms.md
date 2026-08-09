---
title: Write IDEAS.md for an LLM
description: Organize project ideas into useful local context, link them beside the code, and hand them to a coding agent without pretending the file runs itself.
section: projects
order: 20
status: shipped
appliesTo: desktop
lastReviewed: "2026-08-09"
sources:
  - app/src/components/ProjectLink.tsx
  - app/src-tauri/src/project.rs
  - README.md
related:
  - project-linking
  - ideas
  - privacy
searchTerms:
  - LLM context
  - coding agent
  - project ideas
  - agent handoff
  - ideas file
---

## Why keep the idea beside the code?

An idea in the vault is easy to search, connect, and back up. An idea in the project is easy for a
local LLM or coding agent to discover while it inspects the repository. Project linking gives you
both without asking you to maintain two independent notes.

The vault copy remains canonical. `IDEAS.md` is a local mirror refreshed by sudonotes on save and
normally excluded from Git.

## Structure an actionable idea

Give the model enough context to investigate, but preserve decisions that still belong to a person.
This template works for features, fixes, migrations, and research spikes:

```markdown
## Problem

What should change, who experiences the problem, and why now?

## Context

Relevant behavior, prior decisions, links, and likely files.

## Constraints

- Security, compatibility, performance, or product boundaries.
- Things that must not change.

## Acceptance criteria

- An observable result, not an implementation guess.
- A failure or edge case that must be handled.

## Non-goals

- Tempting adjacent work that is deliberately outside scope.

## Open questions

- Decisions the implementer must surface instead of guessing.
```

Specific file names are useful when verified. Avoid inventing a module or architecture before the
repository has been inspected.

## Link it to the project

1. Save the idea in the vault.
2. Use the idea’s **Project** panel to choose the project root.
3. Resolve any existing `IDEAS.md` conflict deliberately.
4. Open the project file once to verify the expected body and frontmatter.

The linked idea takes the project folder’s name in the sidebar. From then on, save the vault note and
let sudonotes refresh the mirror.

## Give a bounded handoff

The file is context, not a command. Pair it with an explicit request:

```text
Read IDEAS.md and inspect the repository. Propose an implementation plan that
respects its constraints. Call out open questions and do not edit files yet.
```

When you are ready for implementation:

```text
Use IDEAS.md as project context. Implement the accepted scope, run the relevant
tests, and report any place where the repository contradicts the idea.
```

This tells the agent what authority it has and makes repository evidence more important than stale
assumptions in the note.

## Keep it useful over time

- Put stable intent and constraints near the top.
- Replace resolved open questions with the decision and its reason.
- Link to sudonotes prompts that contain reusable review or release workflows.
- Remove obsolete claims instead of stacking corrections at the bottom.
- Keep secrets, credentials, customer data, and private production values out of the note.
- Recheck the mirror after moving or renaming the project folder.

## Understand the privacy boundary

A local coding agent can read `IDEAS.md` only if its environment can read the project. Gitignored
does not mean encrypted; other local programs and anyone with filesystem access may still see it.

Remote tools cannot see the mirror merely because a repository exists on GitHub. Uploading the file,
removing the ignore rule, or granting remote access changes that boundary. Inspect the body and its
frontmatter before doing so.

## When one file is not enough

`IDEAS.md` intentionally gives each linked idea one predictable project-level location. If a project
needs many long-lived design documents, keep the current active direction in the linked idea and
use `[[links]]` to related vault notes or normal committed project documentation. Do not turn the
mirror into an undocumented replacement for architecture records that the whole team must review.
