---
title: Note format reference
description: Exact Markdown frontmatter fields, wiki-link and placeholder syntax, filename rules, collections, project paths, and compatibility cautions.
section: reference
order: 10
status: shipped
appliesTo: desktop
lastReviewed: "2026-09-06"
sources:
  - core/src/note.rs
  - app/src-tauri/src/note.rs
  - app/src-tauri/src/lib.rs
related:
  - vault-format
  - blackhole
  - links-and-backlinks
  - placeholders
searchTerms:
  - YAML
  - frontmatter
  - schema
  - models field
  - source field
  - in-page link
---

Each note is one UTF-8 Markdown file with a small YAML-like frontmatter block.

## Complete example

```markdown
---
id: 01K25ABCD1234EFGH5678JKMNP
title: "Review the release"
tags: ["testing", "workflow"]
summary: "Checks the package before publishing."
model: "openai/gpt-5.2"
source: "Release workflow"
position: 2
project: "C:\\code\\release-tool"
mark: green
models: {"Check the migration.":"anthropic/claude-sonnet-4-5"}
bubbleTags: {"Check the migration.":["testing"]}
bubbleIssues: {"Check the migration.":"mory-dev/sudonotes#42"}
created: 2026-08-06T09:12:08Z
updated: 2026-08-09T03:21:10Z
---

Review {{package}} against [[Release standards]].
Report blockers before recommendations.
```

Ordinary notes omit optional keys, so most headers are shorter.

## Frontmatter fields

| Field | Required when written | Meaning |
| --- | --- | --- |
| `id` | Yes | Stable ULID generated for the note |
| `title` | Yes | Display title and wiki-link target |
| `tags` | Yes | Inline list of strings; empty is `[]` |
| `summary` | No | One-line description used in lists and split previews |
| `model` | No | Model ID assigned to the whole note |
| `source` | No | Parent collection title for a child note |
| `position` | No | One-based order within a collection |
| `project` | No | Absolute linked-project path for an idea |
| `mark` | No | Sidebar marker on an idea: `orange` or `green`. Omitted when unmarked |
| `models` | No | JSON object mapping idea-bubble first lines to model IDs |
| `bubbleTags` | No | JSON object mapping idea-bubble first lines to their tags |
| `bubbleIssues` | No | JSON object mapping idea-bubble first lines to `owner/repo#123` |
| `created` | Yes | RFC 3339 creation timestamp |
| `updated` | Yes | RFC 3339 last-write timestamp |

Missing frontmatter is synthesized in memory from the filename and current time. It becomes explicit
the first time sudonotes writes the note.

The three `bubble*`/`models` maps are keyed by a bubble's **first line**. Renaming that line moves
every entry with it; deleting the bubble drops them. Both happen automatically — nothing here needs
maintaining by hand.

<div class="callout">
  <strong class="callout-title">`onHold: true` was replaced by `mark`.</strong>
  Notes written before three-state marking existed still parse: <code>onHold: true</code> reads as
  <code>mark: orange</code>, and the key is rewritten the next time sudonotes saves the note. Only
  <em>which</em> issue a bubble became is stored in <code>bubbleIssues</code> — whether it is open or
  closed is cached in the index and refetched, never written to the file.
</div>

## Parser compatibility

The parser accepts LF or CRLF frontmatter, quoted or bare scalar values, inline tag arrays, a bare
single tag, and block-sequence tags:

```yaml
tags:
  - docs
  - workflow
```

On the next app write, sudonotes normalizes the file to its own inline format.

<div class="callout warning">
  <strong class="callout-title">Custom frontmatter keys are not a supported extension point.</strong>
  Unknown keys are ignored when reading and are not emitted by the serializer, so a later sudonotes
  save can remove them. Put durable custom information in the Markdown body or another file.
</div>

## Body syntax used by sudonotes

### Wiki links

- `[[Target title]]` links to a note.
- `[[Target title|visible label]]` uses an alias.
- A newline before closing brackets invalidates the link.
- Duplicate links in one body produce one target in the extracted link list.

### In-page references

- `((Section))` references a heading or bubble first line within the same note.
- The reference is resolved by a short prefix, so a long heading can be linked by a few words.
- Clicking the reference jumps to it; the parens are ordinary characters in other editors.

### Placeholders

- `{{name}}` defines a prompt variable.
- Surrounding whitespace inside braces is ignored.
- Names are case-sensitive and may contain spaces.

### Idea bubbles

Blank-line-separated paragraphs are editable bubbles. The `models` map uses a bubble’s first line as
its key.

## Filenames

Titles are converted to lowercase filesystem-safe slugs: punctuation becomes a single dash, leading
and trailing dashes are removed, and the result is limited to roughly 60 characters. An empty slug
becomes `untitled`. Collisions receive a unique path rather than overwriting another note.

The title `ideas`, in any letter case, is special-cased to the stem `IDEAS` so a project mirror uses
the conventional uppercase name.

## Blackhole is not a note

The sidebar dump is plain Markdown at `.sudonotes/blackhole.md` with no frontmatter, id, or title.
It is not scanned with prompts and ideas. See [Blackhole](/docs/blackhole).

## Atomic writes

The desktop app writes a sibling `.md.tmp` and renames it over the final path only after the content
is complete. This reduces the chance of a crash truncating an existing note. Temporary files are not
part of the vault format or backup scan.
