---
title: AI assistance and note review
description: Understand automatic tagging, on-demand note review, model-fit feedback, the per-vault switch, and what is sent.
section: write
order: 70
status: shipped
appliesTo: desktop
lastReviewed: "2026-08-09"
sources:
  - app/src/components/AiReview.tsx
  - app/src/components/Settings.tsx
  - app/src-tauri/src/ai.rs
  - worker/src/index.ts
related:
  - privacy
  - tags-and-models
  - settings
searchTerms:
  - AI assistance
  - review note
  - prompt refinement
  - model fit
---

## Turn assistance on or off

Open Settings and use the **AI assistance** switch. The preference belongs to the current vault and
is stored in `.sudonotes/settings.json`. It is on by default.

Turning it off keeps ordinary editing, search, links, manual tags, placeholders, models, backups,
and project linking available. The review button disappears and the app does not send that vault’s
notes to the sudonotes AI service.

## Review a note

With assistance enabled, open a prompt or idea and choose **Review this note**. sudonotes flushes
pending edits first so the review covers what is actually saved.

The result can contain:

- a fit label and explanation for the selected model;
- concrete issues;
- refinement suggestions;
- alternative model IDs where the catalog supports the comparison.

The result is advice displayed in the panel. It does not replace the body automatically. Apply only
the changes that preserve your intent.

## Automatic classification

After a meaningful save, the app may request tags. The response is restricted to the built-in tag
vocabulary and merged with existing tags. Repeated small saves are throttled so normal typing does
not send a request for every character.

## What crosses the boundary

For review and classification, the service receives the note type, title, body, and selected model
when relevant. The provider key lives on the service, so no provider credential is written into the
vault.

Vault paths, project folders, unrelated notes, the search database, and backup archives are not
part of the request. Read the [privacy guide](/docs/privacy) for the complete boundary and current
logging rules.

<div class="callout privacy">
  <strong class="callout-title">Local-first does not mean every optional operation is local.</strong>
  Editing and storage are local. Enabling AI assistance authorizes the current note content to cross
  the machine for the requested review or classification.
</div>
