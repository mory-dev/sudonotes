---
title: Keyboard shortcuts
description: Complete context-aware shortcut reference for global navigation, editing, ideas, collections, links, search, pickers, and dialogs.
section: find
order: 20
status: shipped
appliesTo: desktop
lastReviewed: "2026-08-09"
sources:
  - app/src/App.tsx
  - app/src/components/Editor.tsx
  - app/src/components/SearchPalette.tsx
  - app/src/components/PromptCards.tsx
related:
  - search-and-navigation
  - interface
  - collections
searchTerms:
  - hotkeys
  - keyboard
  - Ctrl K
  - Cmd K
  - Ctrl Shift F
---

Use <kbd>Ctrl</kbd> on Windows and Linux. Use <kbd>Cmd</kbd> on macOS. “Mod” below means the
appropriate key for the platform.

## Global

| Shortcut | Action |
| --- | --- |
| <kbd>Mod</kbd> + <kbd>K</kbd> | Search every prompt and idea |
| <kbd>Mod</kbd> + <kbd>F</kbd> | Search every prompt and idea; does not open browser find |
| <kbd>Mod</kbd> + <kbd>N</kbd> | Create a note of the type currently in view |
| <kbd>Mod</kbd> + <kbd>S</kbd> | Flush the pending automatic save |
| <kbd>Mod</kbd> + <kbd>+</kbd> | Increase interface scale, up to 160% |
| <kbd>Mod</kbd> + <kbd>-</kbd> | Decrease interface scale, down to 70% |
| <kbd>Mod</kbd> + <kbd>0</kbd> | Reset interface scale to 100% |

The desktop app suppresses webview-only commands such as reload, print, open-file, view-source, and
browser find-next. They are not sudonotes shortcuts.

## Note editor

| Shortcut | Action |
| --- | --- |
| <kbd>Mod</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd> | Find within the open note or prompt collection |
| <kbd>Enter</kbd> in find | Next match |
| <kbd>Shift</kbd> + <kbd>Enter</kbd> in find | Previous match |
| <kbd>Esc</kbd> in find | Close find |
| `[[` | Open note linking autocomplete dropdown |
| <kbd>Enter</kbd> / <kbd>Tab</kbd> in autocomplete | Insert selected note link |
| <kbd>Mod</kbd> + <kbd>Z</kbd> | Undo editor change |
| <kbd>Mod</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> | Redo on every platform |
| <kbd>Mod</kbd> + <kbd>Y</kbd> | Redo where supported by the standard editor keymap |
| <kbd>[</kbd> with a selection | Wrap one bracket level; press twice for `[[selection]]` |
| <kbd>Backspace</kbd> on a recognized wrapper | Peel one bracket level |
| <kbd>Mod</kbd> + <kbd>click</kbd> a wiki link | Open the target note |

Standard cursor movement, selection, clipboard, deletion, and Markdown typing follow the native
CodeMirror/browser conventions for the platform.

## Ideas and bubbles

| Shortcut | Action |
| --- | --- |
| <kbd>Mod</kbd> + <kbd>A</kbd> with the caret in a bubble | Select that bubble |
| <kbd>Mod</kbd> + <kbd>A</kbd> with the caret on a blank separator | Fall through to select the whole note |
| <kbd>Esc</kbd> during a bubble drag | Cancel the reorder |

The first line identifies a bubble for per-bubble model metadata, so keep it short and descriptive.

## Collections and cards

| Shortcut | Action |
| --- | --- |
| <kbd>Mod</kbd> + <kbd>Enter</kbd> in a child prompt | Save and return to the parent collection |
| <kbd>Mod</kbd> + <kbd>Enter</kbd> in an edited card | Save title, body, tags, and model |
| <kbd>Esc</kbd> in an edited card | Cancel the card edit |
| <kbd>[</kbd> with selected card text | Wrap it as a wiki link |
| <kbd>Esc</kbd> during a sidebar drag | Cancel the reorder |

## Search, note, model, and tag pickers

| Shortcut | Action |
| --- | --- |
| <kbd>ArrowDown</kbd> | Move to the next result |
| <kbd>ArrowUp</kbd> | Move to the previous result |
| <kbd>Enter</kbd> | Choose the selected result |
| <kbd>Esc</kbd> | Close the picker |
| <kbd>,</kbd> in the tag field | Commit the typed tag |
| <kbd>Backspace</kbd> in an empty tag field | Remove the last tag |

## Dialogs and temporary controls

<kbd>Esc</kbd> closes Settings, confirmation dialogs, context menus, and temporary selection
surfaces. Clicking outside closes non-destructive palettes and menus; a confirmation still requires
an explicit button.

## Shortcut conflicts

If a system utility captures a shortcut first, use the visible control in sudonotes. Global OS or
window-manager bindings take precedence before the app receives a key event. Interface scaling is
sudonotes-only and does not change the font size stored in a note.
