---
title: Prompt placeholders
description: Write reusable prompt variables with double braces, fill them in from the right panel, and copy without rewriting the template.
section: write
order: 40
status: shipped
appliesTo: desktop
lastReviewed: "2026-08-09"
sources:
  - app/src/components/RightPanel.tsx
  - app/src/components/Editor.tsx
related:
  - prompts
  - collections
searchTerms:
  - variables
  - double braces
  - template
  - copy filled
---

## Write a placeholder

Put a name inside double curly braces anywhere in a prompt:

```markdown
Review the diff on {{branch}} for {{risk}}.
Write the result for {{audience}} in under {{word count}} words.
```

Names may contain spaces. Surrounding whitespace is ignored, so `{{language}}` and
`{{ language }}` refer to the same field. Matching is case-sensitive: `{{Language}}` is different.

## Fill and copy

The **Variables** section appears in the right panel and lists each distinct placeholder in the
order it first appears.

1. Enter the values needed for this use.
2. Read the count of fields still blank.
3. Choose **Copy filled**.

Values live only for the current session and are never written back into the Markdown. The prompt
therefore remains a reusable template.

## Partial fills are safe

An empty value does not become an invisible hole. The original `{{name}}` is copied through:

```markdown
Review the TypeScript diff for {{risk}}.
```

That makes an incomplete copy obvious before it is sent elsewhere.

## Reuse a name

Use the same placeholder more than once and fill it once:

```markdown
Explain {{concept}} to a beginner.
Then give one counterexample that clarifies {{concept}}.
```

The right panel shows one `concept` field and replaces both occurrences in the copied text.

## Literal double braces

Any non-empty text inside `{{` and `}}` is treated as a placeholder. If a prompt needs literal
double braces, put that example in a fenced code block for the reader or rewrite the notation; there
is no separate escape syntax in the current editor.
