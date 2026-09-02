---
title: GitHub issues from bubbles
description: Connect a GitHub account, turn an idea bubble into an issue with its metadata attached, and let closed issues mute or retire the bubbles that became them.
section: projects
order: 30
status: shipped
appliesTo: desktop
lastReviewed: "2026-09-02"
sources:
  - app/src-tauri/src/github.rs
  - app/src-tauri/src/lib.rs
  - app/src-tauri/src/project.rs
  - app/src/components/IssueDraft.tsx
  - app/src/components/Editor.tsx
related:
  - project-linking
  - ideas
  - settings
  - privacy
searchTerms:
  - github issue
  - create issue
  - close issue
  - device flow
  - repository
---

An idea bubble that describes real work can become a GitHub issue without being retyped. The bubble
remembers which issue it became, and when that issue closes the bubble stops competing for your
attention.

## What has to be true first

The issue button appears on a bubble only when all of these hold:

1. The note is an **idea**, not a prompt.
2. The idea is [linked to a project](/docs/project-linking).
3. That project is a Git repository whose `origin` points at github.com.

sudonotes reads `origin` out of the project's `.git/config`. All the usual remote spellings work,
including `git@github.com:owner/repo.git` and worktrees whose `.git` is a file. A GitLab or
self-hosted remote is recognised as "not GitHub" and the button stays hidden rather than failing
when you press it.

The detected repository is shown on the project card in the right panel.

## Connecting an account

Settings → **GitHub** → **Connect GitHub**. sudonotes copies a short code for you and opens
github.com to accept it. Approving it there finishes the sign-in.

Signing in grants no repository access on its own — on GitHub those are two separate acts, which is
what keeps the app from seeing every repo you own. If you have not installed sudonotes anywhere yet,
it sends you straight on to pick repositories. Later, **Choose repositories…** in Settings reopens
that page, and trying to file an issue on a repository you have not granted offers the same thing
inline rather than failing.

Access is granted per **account**, not once for everything. If you have repositories under both a
personal account and an organization, each needs its own grant. The prompt in the draft dialog names
the account it needs (“Grant access on `dariomory`…”) and opens GitHub on that account — a plain
install link would be redirected to whichever account you set up first, which is rarely the one you
want. **Choose repositories…** in Settings is not repository-specific, so on a multi-account setup it
may open the account you installed first; use the prompt in the draft dialog when adding a new one.

- Issues are created **by your own account**, not by a bot.
- The sudonotes GitHub App asks only for **Issues: read & write** and **Metadata: read**, on the
  repositories you pick while installing it. It cannot read your code.
- The token is stored in your operating system's credential store — Credential Manager on Windows,
  Keychain on macOS, the Secret Service (GNOME Keyring, KWallet) on Linux. It is never written into
  the vault.

<div class="callout">
  <strong class="callout-title">On Linux, the credential store may need connecting.</strong>
  The Snap package ships the <code>password-manager-service</code> plug but it is not connected
  automatically. Run <code>snap connect sudonotes:password-manager-service</code> once. Until then
  Settings says no credential store is reachable, and everything unrelated to GitHub still works.
</div>

## Creating an issue

Hover a bubble and press the GitHub mark in its menu. A draft opens with an editable title and body.

The draft is written from the bubble, not about it. The model may propose a title and at most one
sentence of framing; your own words have to survive into the body unchanged. That is checked in
code, not merely asked for in the prompt — if the model paraphrases, the original text is restored
under an **Original note** heading before you ever see the draft.

With AI turned off for the vault, or if the model call fails, the draft is simply the bubble itself
with its first line as the title. The dialog behaves the same either way.

The bubble's **tags become labels** on the issue, where GitHub can filter by them. Labels that do not
exist in the repository yet are created. If a repository refuses them, the issue is still filed —
without labels rather than not at all.

A short footer is appended by sudonotes, recording the idea the bubble came from and its model:

```
---
From [sudonotes](https://sudonotes.com) · idea: Roadmap · model: @claude(claude-opus-5)
```

Nothing is filed until you press **Create issue**. Afterwards the link is written into the note's
frontmatter as `bubbleIssues`, keyed by the bubble's first line:

```yaml
bubbleIssues: {"Mute closed bubbles":"mory-dev/sudonotes#42"}
```

Only *which* issue is recorded in Markdown. Whether it is open or closed is cached in the index and
re-fetched, so the note stays clean and never goes stale in a way that survives a sync.

## When an issue closes

Linked issues refresh when you open the vault, whenever you return to the app, and on a five-minute
timer as a backstop. Coming back to the window is the trigger that matters — you close an issue in a
browser, switch back, and the bubble is already up to date. One request covers a repository, so this
stays far inside GitHub's rate limit.

A bubble whose issue has closed is **dimmed**. It stays readable, editable, and searchable — hovering
it restores full contrast. Nothing is deleted.

Deleting is opt-in: **Delete a bubble when its issue closes**, in Settings → GitHub, is off by
default because it removes text you wrote. With it on, a toast reports what went and offers
**Undo** for as long as the app stays open.

Switching it on applies to issues that are *already* closed, not only ones that close afterwards —
the first sync after enabling it can retire several bubbles at once. That is deliberate, so the
setting is useful on the ideas you already have, and it is why the Undo exists.

## Known limitation: bubbles are keyed by their first line

Per-bubble metadata — models, tags, and now issue links — is keyed by the bubble's opening line, the
same way it has always been. Rewriting that line detaches the link: the issue still exists on
GitHub, but the bubble no longer knows about it and will stop dimming when the issue closes. Filing
again re-links it.
