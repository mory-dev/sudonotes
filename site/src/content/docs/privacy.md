---
title: Privacy
description: Know exactly what stays local, what optional AI assistance sends, what the service logs, and which catalog and update checks use the network.
section: data
order: 40
status: shipped
appliesTo: all
lastReviewed: "2026-08-09"
sources:
  - app/src-tauri/src/ai.rs
  - app/src-tauri/src/models.rs
  - worker/src/index.ts
  - app/src/components/UpdateBanner.tsx
related:
  - ai-review
  - project-linking
  - settings
searchTerms:
  - telemetry
  - cookies
  - note content
  - DeepSeek
  - analytics
---

sudonotes has no account and no built-in note sync. Editing, search, backups, links, placeholders,
and project mirroring operate on local files. A small number of optional or metadata-only features
use the network.

## AI assistance

AI assistance is enabled by default per vault. For automatic tagging, a generated title after some
pastes, or **Review this note**, the app sends to `api.sudonotes.com`:

- the note type;
- the title and full body;
- selected-model metadata when a review evaluates fit.

The service currently forwards that request to DeepSeek. The upstream provider receives the content
to produce the answer. The sudonotes Worker does not write message content to its logs.

Open Settings and turn **AI assistance** off to prevent that vault’s note content from being sent
for these features. The preference lives in `.sudonotes/settings.json`; two vaults can choose
differently.

## What the proxy stores and logs

The Cloudflare Worker is in this repository and enforces bounded requests, rate limits, and a daily
spend ceiling.

- Successful log lines contain the model, prompt-token count, completion-token count, and computed
  cost—not note text.
- Upstream error logs contain the event, model, and status—not the request body.
- A random signed device ID provides a stable per-install rate-limit subject. It contains no user
  identity and is cached in the app config directory.
- IP rate limiting stores a keyed, non-reversible hash in a counter. The raw connecting IP is not
  written into the app’s rate-limit storage.
- There is no sudonotes account to associate with the request.

When capacity or the upstream service fails, AI review may fail and automatic classification can use
local keyword logic for that request. Ordinary note storage is unaffected.

## Model catalog

The model picker fetches the public `models.dev/models.json` catalog and caches it for 24 hours in
the app config directory. The request contains no note title, body, vault path, or project path.

## Update checks

At most once a day, the signed desktop build checks the project’s GitHub release manifest for a
newer version. It downloads and installs an update only after you choose the update action. This
request is separate from notes and does not include vault content.

## Files other local programs can see

Local-first is not encryption. Anyone or any program with filesystem access can read:

- vault Markdown;
- local `.bak` archives in the app data directory;
- a linked project’s `IDEAS.md`, even when Git ignores it.

Use operating-system access controls or an encrypted volume when the device is shared. Inspect a
project mirror before deliberately committing or uploading it because frontmatter may include an
absolute local path.

## This website

The website is static, uses self-hosted fonts, and has no cookies, third-party scripts, or analytics.
Documentation search uses a static Pagefind index in the browser. Search queries and in-page find
text are not transmitted to sudonotes.

<div class="callout privacy">
  <strong class="callout-title">Check the promise.</strong>
  The desktop app and API Worker are MIT-licensed in the same repository. Privacy-sensitive docs
  list their source files and review date so changes can be checked against code.
</div>
