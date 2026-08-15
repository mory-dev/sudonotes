import { useEffect, useMemo, useRef, useState } from "react";

import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, redo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  defaultHighlightStyle,
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import {
  EditorState,
  Prec,
  RangeSetBuilder,
  StateEffect,
  type Extension,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  keymap,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { useStore } from "../store";
import { getUiZoom, viewportToLayout } from "../uiScale";
import { tagHoverColor } from "../tagColors";
import { ModelPicker } from "./ModelPicker";
import { providerMarkHtml, providerOf, shortModelName } from "./ProviderMarks";

/** Split pasted text into clean paragraphs (separated by a single blank line)
 *  so an imported notepad-style file becomes distinct idea bubbles. */
function normalizePastedText(text: string): string {
  const groups = text.split(/\n\s*\n/).map((g) => g.trim()).filter(Boolean);
  if (groups.length <= 1) return text;
  return `${groups.join("\n\n")}\n`;
}

function projectInitial(project: string | null | undefined): string {
  const name = project?.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  return (name.charAt(0) || "?").toUpperCase();
}

/** Autocomplete dropdown when typing `[[` to link to notes in the vault. */
function wikiLinkCompletionSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/\[\[([^\]\n|]*)/);
  if (!match) return null;

  const query = match.text.slice(2);
  const notes = useStore.getState().notes;
  const activeId = useStore.getState().active?.id;

  const needle = query.trim().toLowerCase();
  const hits = notes
    .filter((n) => !needle || n.title.toLowerCase().includes(needle))
    .slice(0, 50);

  if (hits.length === 0) return null;

  return {
    from: match.from + 2,
    to: context.pos,
    options: hits.map((note) => {
      const typeLabel = note.type === "prompt" ? "prompt" : "idea";
      const detail = note.collection
        ? `in ${note.collection}`
        : note.project
        ? `project: ${projectInitial(note.project)}`
        : typeLabel;

      return {
        label: note.title,
        type: note.type,
        detail,
        boost: note.id === activeId ? -1 : 0,
        apply: (view: EditorView, completion: { label: string }, from: number, to: number) => {
          const doc = view.state.doc;
          const after = doc.sliceString(to, to + 2);
          let insert = completion.label;
          let targetPos = from + insert.length;

          if (after === "]]") {
            targetPos += 2;
          } else if (after.startsWith("]")) {
            insert += "]";
            targetPos += 2;
          } else {
            insert += "]]";
            targetPos += 2;
          }

          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: targetPos },
          });
        },
      };
    }),
    filter: false,
  };
}

const WIKILINK = /\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g;

/** Hides the syntax so a link reads as ordinary highlighted text. */
const hidden = Decoration.replace({});

const markdownHighlightStyle = HighlightStyle.define(
  defaultHighlightStyle.specs.map((spec) =>
    spec.tag === tags.heading ? { ...spec, textDecoration: "none" } : spec,
  ),
);

const label = (target: string) =>
  Decoration.mark({
    class: "cm-wikilink",
    attributes: {
      "data-target": target,
      "data-tooltip": `Ctrl+click to open "${target}"`,
    },
  });

class LinkProjectIconWidget extends WidgetType {
  constructor(
    readonly icon: string | null | undefined,
    readonly project: string,
  ) {
    super();
  }

  eq(other: LinkProjectIconWidget) {
    return this.icon === other.icon && this.project === other.project;
  }

  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "cm-wikilink-project-wrap";
    if (this.icon) {
      const img = document.createElement("img");
      img.className = "cm-wikilink-project-icon";
      img.src = this.icon;
      img.alt = "";
      img.setAttribute("data-tooltip", this.project);
      wrap.appendChild(img);
    } else {
      const span = document.createElement("span");
      span.className = "cm-wikilink-project-icon placeholder";
      const initial = (
        this.project.replace(/[\\/]+$/, "").split(/[\\/]/).pop()?.charAt(0) || "?"
      ).toUpperCase();
      span.textContent = initial;
      span.setAttribute("data-tooltip", this.project);
      wrap.appendChild(span);
    }
    return wrap;
  }
}

/**
 * Render `[[Target]]` as just `Target`, highlighted — the brackets only appear
 * while the cursor is inside the link, so it stays editable without ever
 * showing markup you did not ask to see.
 */
function buildLinkDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const cursor = view.state.selection.main;
  const notes = useStore.getState().notes;

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    WIKILINK.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = WIKILINK.exec(text))) {
      const start = from + match.index;
      const end = start + match[0].length;
      const target = match[1].trim();
      const alias = match[2];
      const targetNote = notes.find((n) => n.title.toLowerCase() === target.toLowerCase());

      // Reveal the raw syntax when the caret is in or beside the link.
      if (cursor.from <= end && cursor.to >= start) {
        if (targetNote?.project) {
          builder.add(
            start,
            start,
            Decoration.widget({
              widget: new LinkProjectIconWidget(targetNote.icon, targetNote.project),
              side: -1,
            }),
          );
        }
        builder.add(start, end, label(target));
        continue;
      }

      builder.add(start, start + 2, hidden);
      const inner = start + 2;
      const closing = end - 2;

      if (targetNote?.project) {
        builder.add(
          inner,
          inner,
          Decoration.widget({
            widget: new LinkProjectIconWidget(targetNote.icon, targetNote.project),
            side: 1,
          }),
        );
      }

      if (alias === undefined) {
        builder.add(inner, closing, label(target));
      } else {
        // `[[Target|alias]]` shows only the alias.
        const pipe = inner + match[1].length;
        builder.add(inner, pipe + 1, hidden);
        builder.add(pipe + 1, closing, label(target));
      }

      builder.add(closing, end, hidden);
    }
  }

  return builder.finish();
}

const wikiLinks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildLinkDecorations(view);
    }
    update(update: ViewUpdate) {
      // Selection matters too: moving the caret in or out of a link changes
      // whether its brackets are shown.
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildLinkDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    // Arrow keys step over a collapsed link rather than into hidden brackets.
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  },
);

/** The markdown heading level of an ATX node, or null for other nodes. */
const headingLevel = (nodeName: string): number | null => {
  const m = /^ATXHeading(\d)$/.exec(nodeName);
  return m ? Number(m[1]) : null;
};

/** Scale headings so `#` reads largest, `######` smallest, and the leading
 *  hash marks stay subtle instead of shouting. */
function buildHeadingDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({ from, to, enter: (node) => {
      const level = headingLevel(node.name);
      if (!level) return;
      const line = view.state.sliceDoc(node.from, node.to);
      const text = line.replace(/^#{1,6}\s*/, "");
      const markStart = node.from;
      const markEnd = node.from + (line.length - text.length);
      const start = markEnd;
      const end = Math.min(node.to, to);
      if (markStart < markEnd) {
        builder.add(markStart, Math.min(markEnd, to), Decoration.mark({ class: "cm-heading-mark" }));
      }
      if (start < end) {
        builder.add(start, end, Decoration.mark({ class: `cm-heading${level}` }));
      }
    }});
  }
  return builder.finish();
}

/** Mark `{{name}}` in a prompt so a template is visibly a template. The
 *  right panel turns the same matches into fields to fill in. */
const PLACEHOLDER = /\{\{\s*[^{}]+?\s*\}\}/g;

function buildPlaceholderDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (useStore.getState().active?.type !== "prompt") return builder.finish();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    PLACEHOLDER.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PLACEHOLDER.exec(text))) {
      builder.add(
        from + match.index,
        from + match.index + match[0].length,
        Decoration.mark({ class: "cm-placeholder-var" }),
      );
    }
  }
  return builder.finish();
}

const placeholders = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildPlaceholderDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildPlaceholderDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const headings = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildHeadingDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildHeadingDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** The top-level bubbles of an idea note: each block group and whether it
 *  starts with a heading. Shared by the bubble decorations, the heat bars,
 *  Ctrl+A, and the hover menu's copy button. */
function computeBubbles(state: EditorState): { from: number; to: number; heading: boolean }[] {
  const doc = state.doc;
  const runs: { from: number; to: number; heading: boolean; seeded: boolean }[] = [];
  let run: { from: number; to: number; heading: boolean; seeded: boolean } | null = null;
  const closeRun = () => {
    if (run) {
      runs.push(run);
      run = null;
    }
  };
  const top = syntaxTree(state).topNode;
  for (let node = top.firstChild; node; node = node.nextSibling) {
    const name = node.name;
    const isHeading = name.startsWith("ATXHeading") || name.startsWith("SetextHeading");
    const boxable =
      isHeading ||
      name === "Paragraph" ||
      name === "BulletList" ||
      name === "OrderedList" ||
      name === "Blockquote";
    if (!boxable) {
      closeRun();
      continue;
    }
    if (!run) {
      run = { from: node.from, to: node.to, heading: isHeading, seeded: !isHeading };
      continue;
    }
    if (isHeading) {
      closeRun();
      run = { from: node.from, to: node.to, heading: true, seeded: false };
      continue;
    }
    const gapLines = doc.lineAt(node.from).number - doc.lineAt(run.to).number;
    if ((run.heading && !run.seeded) || gapLines <= 1) {
      run.seeded = true;
      run.to = node.to;
    } else {
      closeRun();
      run = { from: node.from, to: node.to, heading: false, seeded: true };
    }
  }
  closeRun();
  return runs;
}

/** The heading text identifying the bubble that contains `pos`, or null when
 *  the position is between bubbles. This is the same key `setBubbleModel`
 *  stores a model under, so the right panel and the hover menu agree. */
function bubbleLabelAt(state: EditorState, pos: number): string | null {
  const bubble = computeBubbles(state).find(
    (b) => pos >= b.from && pos <= b.to && b.from !== b.to,
  );
  if (!bubble) return null;
  return state.doc.lineAt(bubble.from).text.trim() || null;
}

/** Rebuild the note with the bubble at `fromIndex` moved to `toIndex`, keeping
 *  the separators between bubbles in their original slots so nothing outside
 *  the moved bubble's own text changes. Returns null for a no-op, or the new
 *  body together with the moved bubble's new first-line offset. */
function reorderBubbles(
  state: EditorState,
  fromIndex: number,
  toIndex: number,
): { body: string; at: number } | null {
  const doc = state.doc;
  const bubbles = computeBubbles(state);
  const n = bubbles.length;
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= n || toIndex < 0 || toIndex >= n) {
    return null;
  }
  const prefix = doc.sliceString(0, bubbles[0].from);
  const suffix = doc.sliceString(bubbles[n - 1].to, doc.length);
  const texts = bubbles.map((b) => doc.sliceString(b.from, b.to));
  const seps = bubbles.map((b, i) =>
    doc.sliceString(b.to, i < n - 1 ? bubbles[i + 1].from : b.to),
  );
  const [moved] = texts.splice(fromIndex, 1);
  texts.splice(toIndex, 0, moved);
  let out = prefix;
  let at = -1;
  for (let i = 0; i < n; i++) {
    if (i === toIndex) at = out.length;
    out += texts[i] + seps[i];
  }
  return { body: out + suffix, at };
}

/** The `.cm-line` element containing `pos`, or null when it maps to no line. */
function lineElementAt(view: EditorView, pos: number): HTMLElement | null {
  const dom = view.domAtPos(pos);
  const el = dom.node instanceof Element ? dom.node : dom.node.parentElement;
  return el?.closest(".cm-line") ?? null;
}

/** The bubble boundary (0..bubbles.length) a drag pointer is hovering: over a
 *  bubble, its top half means before it and its bottom half means after it; a
 *  position between bubbles resolves to the boundary after the last one that
 *  starts before it. */
function bubbleBoundaryAt(view: EditorView, x: number, y: number): number | null {
  const pos = view.posAtCoords({ x, y });
  if (pos == null) return null;
  const bubbles = computeBubbles(view.state);
  const n = bubbles.length;
  if (n === 0) return null;
  const index = bubbles.findIndex((b) => pos >= b.from && pos <= b.to);
  if (index >= 0) {
    const line = lineElementAt(view, pos);
    const rect = line?.getBoundingClientRect();
    const before = !rect || y < rect.top + rect.height / 2;
    return Math.max(0, Math.min(n, before ? index : index + 1));
  }
  return Math.max(0, Math.min(n, bubbles.filter((b) => b.from < pos).length));
}

/** Priority indicator for a bubble: a horizontal "volume" bar in the right
 *  gutter (outside the bubble) whose width and colour fade from hot (high rank)
 *  to cool (low rank) against the note's other bubbles.
 *
 *  The ramp is red → orange → yellow → gray → gone. Hue only ever travels the
 *  warm end of the wheel, and the cool end of the scale is reached by draining
 *  the saturation and then mixing into the editor background, so the lowest
 *  bubble's bar is literally the background colour rather than a cold one. */
class BubbleHeatWidget extends WidgetType {
  constructor(readonly heat: number) {
    super();
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-bubble-heat";
    // Hue reaches yellow by the upper third and stops there; past that the bar
    // greys out rather than continuing round towards green.
    const hue = Math.round(6 + 42 * Math.min(1, (1 - this.heat) / 0.35));
    const saturation = Math.round(80 * this.heat);
    // Slightly concave, so the fade to nothing happens over the last bubbles
    // instead of dimming the whole scale evenly.
    const presence = Math.round(100 * this.heat ** 0.6);
    el.style.setProperty(
      "--heat-color",
      `color-mix(in oklab, hsl(${hue} ${saturation}% 52%) ${presence}%, var(--bg))`,
    );
    el.style.setProperty("--heat-width", `${Math.round(14 + 36 * this.heat)}px`);
    el.setAttribute("data-tooltip", "Priority");
    return el;
  }
  eq(other: BubbleHeatWidget) {
    return other.heat === this.heat;
  }
}

/** Drag handle for an idea bubble, in the left gutter opposite its heat bar.
 *  The bubble's own text stays selectable, so only this small grip is the
 *  drag handle; the reorder runs in the editor's pointer-based drag. */
class BubbleGripWidget extends WidgetType {
  constructor(readonly from: number) {
    super();
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-bubble-grip";
    // Not `draggable` — the reorder is a custom pointer drag, which avoids the
    // browser's native drag cursor fighting CodeMirror's own drag handling.
    el.setAttribute("data-tooltip", "Drag to reorder");
    el.setAttribute("data-from", String(this.from));
    el.innerHTML =
      '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 3h8M2 6h8M2 9h8"/></svg>';
    // Intercept mousedown on the grip itself, before CodeMirror's own event
    // handling can place a caret or start a text drag, and hand the drag off
    // to the editor component (widgets are built outside React, so this is the
    // one shared channel back into it).
    el.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      gripDragStart.onDown?.(this.from, event.clientX, event.clientY);
    });
    return el;
  }
  eq(other: BubbleGripWidget) {
    return other.from === this.from;
  }
}

/** One-way bridge from grip widgets to the Editor component's drag handler,
 *  since widgets are created by the decoration plugins, outside React. */
const gripDragStart: { onDown: ((from: number, x: number, y: number) => void) | null } = {
  onDown: null,
};

/** A little pill at a bubble's bottom-right corner naming the model assigned
 *  to that bubble — the idea's model lives on its bubbles, not the note row. */
class BubbleModelBadgeWidget extends WidgetType {
  constructor(readonly model: string) {
    super();
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-bubble-model";
    el.setAttribute("data-tooltip", this.model);
    const provider = providerOf(this.model);
    const mark = document.createElement("span");
    mark.innerHTML = providerMarkHtml(provider, 12);
    const tile = mark.firstElementChild as HTMLElement | null;
    if (tile) el.appendChild(tile);
    const name = document.createElement("span");
    name.className = "cm-bubble-model-name";
    // The id's last segment, hyphenated as in "claude-opus-5", reads better as
    // "opus 5" once the brand prefix is dropped.
    const segment = this.model.slice(this.model.lastIndexOf("/") + 1).replace(/-/g, " ");
    name.textContent = shortModelName(segment, provider);
    el.appendChild(name);
    return el;
  }
  eq(other: BubbleModelBadgeWidget) {
    return other.model === this.model;
  }
}

/** Wrap each idea in the note in a subtle box: a paragraph together with any
 *  list or quote that follows it directly forms one bubble. Only applied to
 *  idea notes; prompt children keep the bare editor. */
function buildParagraphDecorations(view: EditorView): DecorationSet {
  if (useStore.getState().active?.type !== "idea") {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const runs = computeBubbles(view.state);

  for (const block of runs) {
    const firstLine = doc.lineAt(block.from);
    const lastLine = doc.lineAt(block.to);
    for (let n = firstLine.number; n <= lastLine.number; n++) {
      const line = doc.line(n);
      const classes = [
        "cm-para",
        n === firstLine.number ? "first" : "",
        n === lastLine.number ? "last" : "",
        n === firstLine.number && block.heading ? "cm-bubble-header" : "",
      ]
        .filter(Boolean)
        .join(" ");
      // A zero-length range at the line start applies the class to the whole
      // line without disturbing its content.
      builder.add(line.from, line.from, Decoration.line({ class: classes }));
    }
  }
  return builder.finish();
}

/** The priority heat bars, in their own plugin: a widget sharing its position
 *  with a line decoration is not rendered, so the bars live apart from the
 *  bubble boxes. */
function buildHeatDecorations(view: EditorView): DecorationSet {
  if (useStore.getState().active?.type !== "idea") {
    return Decoration.none;
  }
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const runs = computeBubbles(view.state);
  const total = runs.length;
  const models = useStore.getState().active?.models ?? {};
  for (const [index, block] of runs.entries()) {
    const firstLine = doc.lineAt(block.from);
    const heat = total <= 1 ? 1 : 1 - index / (total - 1);
    // Widgets at one position must be added by ascending `side` — grip (-1)
    // before heat (+1) — or RangeSetBuilder rejects the set.
    builder.add(
      firstLine.from,
      firstLine.from,
      Decoration.widget({ widget: new BubbleGripWidget(firstLine.from), side: -1 }),
    );
    builder.add(
      firstLine.from,
      firstLine.from,
      Decoration.widget({ widget: new BubbleHeatWidget(heat), side: 1 }),
    );
    // The model assigned to this bubble, named by its first line, shows as a
    // badge directly below the heat bar.
    const label = doc.lineAt(block.from).text.trim();
    const model = models[label];
    if (model) {
      builder.add(
        firstLine.from,
        firstLine.from,
        Decoration.widget({ widget: new BubbleModelBadgeWidget(model), side: 1 }),
      );
    }
  }
  return builder.finish();
}

/** Signals the heat/badge plugin that a bubble's model assignment changed, so
 *  the badge appears as soon as a model is picked without an edit. */
const bubbleModelsEffect = StateEffect.define<null>();

const heatBars = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    alive = true;
    unsubscribe: () => void;
    constructor(view: EditorView) {
      this.decorations = buildHeatDecorations(view);
      // Rebuild when the open note's per-bubble models change (e.g. a model is
      // assigned from the hover menu) without any document edit.
      this.unsubscribe = useStore.subscribe((state, previous) => {
        if (this.alive && state.active?.models !== previous.active?.models) {
          view.dispatch({ effects: bubbleModelsEffect.of(null) });
        }
      });
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.transactions.some((tr) => tr.effects.some((effect) => effect.is(bubbleModelsEffect)))
      ) {
        this.decorations = buildHeatDecorations(update.view);
      }
    }
    destroy() {
      this.alive = false;
      this.unsubscribe();
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const paragraphBoxes = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildParagraphDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildParagraphDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** Highlight the whole idea bubble (all its lines) on hover, not each line.
 *  The tint is set from the note's first tag color via --para-hover. */
/** Highlight the whole idea bubble (all its lines) on hover, not each line.
 *  The tint is set from the note's first tag color via --para-hover. */

/** The `.cm-line.cm-para` under an event target, walking up from a text node. */
function paraLineOf(target: EventTarget | null): HTMLElement | null {
  const node = target instanceof Node ? target : null;
  const el = node instanceof Element ? node : node?.parentElement;
  return el ? (el.closest(".cm-line.cm-para") as HTMLElement | null) : null;
}

/** The first line of the bubble a hovered line belongs to. */
function bubbleFirstLine(line: HTMLElement): HTMLElement {
  let first = line;
  let prev = first.previousElementSibling;
  while (prev instanceof HTMLElement && prev.classList.contains("cm-para")) {
    first = prev;
    prev = first.previousElementSibling;
  }
  return first;
}

class BubbleHover {
  current: HTMLElement[] = [];
  clear() {
    for (const el of this.current) el.classList.remove("cm-para-hover");
    this.current = [];
  }
  update(update: ViewUpdate) {
    // Lines are recreated on scroll/edit; drop any stale highlight.
    if (update.docChanged || update.viewportChanged) this.clear();
  }
  onMouseOver(event: MouseEvent) {
    const line = paraLineOf(event.target);
    if (!line) {
      this.clear();
      return;
    }
    if (this.current.includes(line)) return;
    this.clear();
    const bubble: HTMLElement[] = [line];
    let el = line.previousElementSibling;
    while (el && el.classList.contains("cm-para")) {
      bubble.unshift(el as HTMLElement);
      el = el.previousElementSibling;
    }
    el = line.nextElementSibling;
    while (el && el.classList.contains("cm-para")) {
      bubble.push(el as HTMLElement);
      el = el.nextElementSibling;
    }
    for (const item of bubble) item.classList.add("cm-para-hover");
    this.current = bubble;
  }
  onMouseOut(event: MouseEvent) {
    const related = paraLineOf(event.relatedTarget);
    if (related && this.current.includes(related)) return;
    this.clear();
  }
}

const bubbleHover = ViewPlugin.fromClass(BubbleHover, {
  eventHandlers: {
    mouseover(event) {
      this.onMouseOver(event);
    },
    mouseout(event) {
      this.onMouseOut(event);
    },
  },
});

/** Find-in-file state, passed from the UI through a transaction effect. */
type FindState = { query: string; index: number; move: boolean } | null;
const findEffect = StateEffect.define<FindState>();

/** Case-insensitive, non-overlapping matches of `query` in the document. */
function findMatches(doc: Text, query: string): { from: number; to: number }[] {
  const matches: { from: number; to: number }[] = [];
  const needle = query.toLocaleLowerCase();
  if (!needle) return matches;
  const length = query.length;
  let from = 0;
  for (;;) {
    const text = doc.sliceString(from, doc.length).toLocaleLowerCase();
    const idx = text.indexOf(needle);
    if (idx === -1) break;
    const matchFrom = from + idx;
    matches.push({ from: matchFrom, to: matchFrom + length });
    from = matchFrom + length;
    if (from >= doc.length) break;
  }
  return matches;
}

/** Highlights every find match and the current one; scrolls on move. */
const findPlugin = ViewPlugin.fromClass(
  class {
    query = "";
    matches: { from: number; to: number }[] = [];
    update(update: ViewUpdate) {
      let state: FindState | undefined = undefined;
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(findEffect)) state = effect.value;
        }
      }
      if (state !== undefined) {
        this.apply(update.view, state);
      } else if (update.docChanged && this.query) {
        this.apply(update.view, useStore.getState().find);
      }
    }
    apply(view: EditorView, find: FindState) {
      if (!find || !find.query) {
        this.query = "";
        this.matches = [];
        useStore.setState({ findCount: 0 });
        return;
      }
      this.query = find.query;
      this.matches = findMatches(view.state.doc, find.query);
      useStore.setState({ findCount: this.matches.length });
      if (find.move && this.matches.length > 0) {
        const index = Math.max(0, Math.min(find.index, this.matches.length - 1));
        const pos = this.matches[index].from;
        // CodeMirror forbids dispatching a transaction from inside an update
        // cycle, and `apply` runs from `update`. Dispatching here was silently
        // dropped, which is why Enter highlighted the next match but never
        // scrolled to it. Defer to the next frame instead.
        requestAnimationFrame(() => {
          if (this.destroyed) return;
          view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "center" }) });
        });
      }
    }
    destroyed = false;
    destroy() {
      this.destroyed = true;
    }
  },
  {
    decorations: (plugin) => {
      const builder = new RangeSetBuilder<Decoration>();
      const find = useStore.getState().find;
      const index = find?.index ?? 0;
      for (const [i, match] of plugin.matches.entries()) {
        builder.add(
          match.from,
          match.to,
          Decoration.mark({ class: i === index ? "cm-find-match current" : "cm-find-match" }),
        );
      }
      return builder.finish();
    },
  },
);
/** Deepest wrap `[` will build. Five is past anything markdown gives meaning
 *  to, which is the point: the levels above two are the user's to use. */
const MAX_BRACKETS = 5;

/** How many matched `[`/`]` pairs sit immediately around `[from, to)`. */
function bracketDepth(doc: Text, from: number, to: number): number {
  let depth = 0;
  while (
    from - depth - 1 >= 0 &&
    to + depth + 1 <= doc.length &&
    doc.sliceString(from - depth - 1, from - depth) === "[" &&
    doc.sliceString(to + depth, to + depth + 1) === "]"
  ) {
    depth++;
  }
  return depth;
}

/** `[` over a selection is `closeBrackets`' job — it adds one pair per press,
 *  which is what lets a word be wrapped one bracket at a time. This only steps
 *  in at the ceiling, swallowing the key so the wrap stops growing. */
function limitBracketWrap(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  if (from === to) return false;
  return bracketDepth(view.state.doc, from, to) >= MAX_BRACKETS;
}

/** Backspace takes one bracket level off a wrapped word instead of destroying
 *  it, so a wrap walks back down 5-4-3-2-1 the way it was built up.
 *
 *  Two shapes reach here. With the word still selected from wrapping it, the
 *  pair either side of the selection comes off and the selection stays, so the
 *  key can be held. With a bare caret just past the closing brackets, the
 *  outermost pair comes off — the default binding would take the whole
 *  `[[word]]` at once, since a collapsed link is one atomic range. */
function peelBrackets(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;

  if (from !== to) {
    if (bracketDepth(doc, from, to) === 0) return false;
    view.dispatch({
      changes: [
        { from: from - 1, to: from },
        { from: to, to: to + 1 },
      ],
      selection: { anchor: from - 1, head: to - 1 },
      userEvent: "delete.unwrap",
    });
    return true;
  }

  // Trailing `]` run immediately before the caret.
  let close = 0;
  while (close < MAX_BRACKETS && from - close - 1 >= 0) {
    if (doc.sliceString(from - close - 1, from - close) !== "]") break;
    close++;
  }
  if (close === 0) return false;

  // The word being wrapped ends where that run starts; its opening run is the
  // nearest `[` before it.
  const contentEnd = from - close;
  let cursor = contentEnd - 1;
  while (cursor >= 0 && doc.sliceString(cursor, cursor + 1) !== "[") cursor--;
  if (cursor < 0) return false;

  let open = 0;
  while (open < close && cursor - open >= 0) {
    if (doc.sliceString(cursor - open, cursor - open + 1) !== "[") break;
    open++;
  }
  if (open === 0) return false;

  const outermost = cursor - open + 1;
  view.dispatch({
    changes: [
      { from: outermost, to: outermost + 1 },
      { from: from - 1, to: from },
    ],
    selection: { anchor: from - 2 },
    userEvent: "delete.unwrap",
  });
  return true;
}

const theme = EditorView.theme(
  {
    "&": { height: "100%", fontSize: "15px", backgroundColor: "transparent" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.7",
      padding: "8px 24px 40vh",
      position: "relative",
    },
    ".cm-content": { caretColor: "var(--accent)", maxWidth: "80ch" },
    ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
    ".cm-wikilink": {
      color: "var(--accent)",
      backgroundColor: "var(--accent-soft)",
      borderRadius: "3px",
      padding: "1px 3px",
      cursor: "pointer",
    },
    ".cm-wikilink:hover": { backgroundColor: "var(--selection)" },
    ".cm-wikilink-project-wrap": {
      display: "inline-flex",
      alignItems: "center",
      verticalAlign: "middle",
      marginRight: "4px",
    },
    ".cm-wikilink-project-icon": {
      display: "inline-block",
      width: "13px",
      height: "13px",
      borderRadius: "3px",
      objectFit: "contain",
      verticalAlign: "middle",
      background: "var(--panel-2)",
    },
    ".cm-wikilink-project-icon.placeholder": {
      display: "inline-grid",
      placeItems: "center",
      fontSize: "8px",
      fontWeight: "700",
      lineHeight: "1",
      color: "var(--muted)",
      border: "1px solid var(--border)",
    },
    ".cm-heading1": { fontSize: "1.1em", fontWeight: 600 },
    ".cm-heading2": { fontSize: "1.05em", fontWeight: 600 },
    ".cm-heading3": { fontSize: "1em", fontWeight: 600 },
    ".cm-heading4": { fontSize: "0.95em", fontWeight: 600 },
    ".cm-heading5": { fontSize: "0.9em", fontWeight: 600 },
    ".cm-heading6": { fontSize: "0.85em", fontWeight: 600 },
    ".cm-heading-mark": {
      color: "var(--muted)",
      opacity: 0.55,
      fontWeight: 600,
    },
    ".cm-para": {
      borderLeft: "1px solid rgba(255,255,255,0.08)",
      borderRight: "1px solid rgba(255,255,255,0.08)",
      paddingLeft: "12px",
      paddingRight: "12px",
    },
    ".cm-para.first": {
      borderTop: "1px solid rgba(255,255,255,0.08)",
      borderTopLeftRadius: "8px",
      borderTopRightRadius: "8px",
      paddingTop: "5px",
    },
    ".cm-para.last": {
      borderBottom: "1px solid rgba(255,255,255,0.08)",
      borderBottomLeftRadius: "8px",
      borderBottomRightRadius: "8px",
      paddingBottom: "5px",
    },
    ".cm-para.first.cm-bubble-header": {
      background: "rgba(255,255,255,0.045)",
      borderBottom: "1px solid rgba(255,255,255,0.08)",
    },
    // The header's own background is more specific than the hover tint, so the
    // hover rule would lose on the bubble's first line; restate it explicitly.
    ".cm-para.first.cm-bubble-header.cm-para-hover": {
      background: "var(--para-hover, rgba(255,255,255,0.06))",
    },
    ".cm-para-hover": {
      backgroundColor: "var(--para-hover, rgba(255,255,255,0.06))",
      borderLeftColor: "rgba(255,255,255,0.18)",
      borderRightColor: "rgba(255,255,255,0.18)",
    },
    ".cm-para-hover.first": { borderTopColor: "rgba(255,255,255,0.18)" },
    ".cm-para-hover.last": { borderBottomColor: "rgba(255,255,255,0.18)" },
    // Horizontal priority "volume" bar in the right gutter, anchored to the
    // scroller (not the line) so it sits outside the bubble, clear of the
    // scrollbar at the very edge.
    ".cm-bubble-heat": {
      position: "absolute",
      right: "12px",
      top: "auto",
      width: "var(--heat-width)",
      height: "1px",
      borderRadius: "1px",
      opacity: 0.8,
      background: "var(--heat-color)",
    },
    // Reorder grip for a bubble, in the left gutter; hidden until its bubble is
    // hovered, and kept visible for the bubble being dragged.
    ".cm-bubble-grip": {
      position: "absolute",
      left: "8px",
      top: "auto",
      width: "14px",
      height: "14px",
      display: "grid",
      placeItems: "center",
      color: "var(--muted)",
      cursor: "grab",
      opacity: 0,
      borderRadius: "4px",
      transition: "opacity 120ms ease",
    },
    ".cm-line.cm-para-hover .cm-bubble-grip, .cm-bubble-grip:hover, .cm-bubble-grip.dragging":
      {
        opacity: 1,
      },
    ".cm-bubble-grip:hover": { color: "var(--text)" },
    ".cm-bubble-grip.dragging": { cursor: "grabbing", color: "var(--text)" },
    ".cm-bubble-grip svg": {
      width: "12px",
      height: "12px",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.4",
      strokeLinecap: "round",
      pointerEvents: "none",
    },
    // Model badge at a bubble's bottom-right corner, naming the model assigned
    // to that bubble. Floats in the right gutter, just below the heat bar.
    ".cm-bubble-model": {
      position: "absolute",
      right: "12px",
      top: "auto",
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      maxWidth: "140px",
      padding: "1px 6px 1px 2px",
      fontSize: "10px",
      fontWeight: 600,
      lineHeight: "1.3",
      color: "var(--muted)",
      background: "var(--panel)",
      border: "1px solid var(--border)",
      borderRadius: "999px",
      transform: "translateY(5px)",
    },
    ".cm-bubble-model-name": {
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    ".provider-mark": {
      display: "grid",
      placeItems: "center",
      flex: "none",
      borderRadius: "4px",
    },
    ".provider-mark svg": { display: "block" },
    ".provider-mark-fallback": { color: "#fff", fontWeight: 700, lineHeight: 1 },
    ".cm-find-match": {
      backgroundColor: "rgba(247, 168, 42, 0.2)",
      borderRadius: "2px",
    },
    ".cm-find-match.current": {
      backgroundColor: "rgba(247, 168, 42, 0.42)",
      outline: "1px solid rgba(247, 168, 42, 0.75)",
    },
    ".cm-tooltip.cm-tooltip-autocomplete": {
      background: "var(--panel)",
      border: "1px solid var(--border)",
      borderRadius: "8px",
      boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
      padding: "4px",
      minWidth: "220px",
      maxWidth: "360px",
      maxHeight: "260px",
      overflow: "hidden",
    },
    ".cm-tooltip-autocomplete > ul": {
      fontFamily: "var(--font-sans, inherit)",
      fontSize: "12.5px",
      maxHeight: "250px",
      overflowY: "auto",
      padding: "2px",
      margin: 0,
      listStyle: "none",
    },
    ".cm-tooltip-autocomplete > ul > li": {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "5px 8px",
      borderRadius: "5px",
      color: "var(--text)",
      cursor: "pointer",
    },
    ".cm-tooltip-autocomplete > ul > li:hover": {
      background: "var(--panel-2)",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      background: "var(--accent-soft)",
      color: "var(--accent)",
    },
    ".cm-completionLabel": {
      fontWeight: 500,
      flex: 1,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    ".cm-completionDetail": {
      fontSize: "11px",
      color: "var(--muted)",
      fontStyle: "normal",
      opacity: 0.8,
    },
    ".cm-completionMatchedText": {
      color: "var(--accent)",
      fontWeight: 700,
      textDecoration: "underline",
    },
    "&.cm-editor .cm-selectionBackground, ::selection": {
      backgroundColor: "var(--selection-bg)",
    },
  },
  { dark: true },
);

export function Editor() {
  const active = useStore((s) => s.active);
  const docVersion = useStore((s) => s.docVersion);
  const insertLink = useStore((s) => s.insertLink);
  const scrollTo = useStore((s) => s.scrollTo);
  const find = useStore((s) => s.find);
  const findCount = useStore((s) => s.findCount);
  const closeFind = useStore((s) => s.closeFind);
  const setFindQuery = useStore((s) => s.setFindQuery);
  const findMove = useStore((s) => s.findMove);

  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const activeId = useRef<string | null>(null);
  // The editor's configuration, built once at mount and reused whenever a note
  // is swapped in, so each note gets a fresh document and its own undo history.
  const extensionsRef = useRef<Extension[]>([]);
  // Set while the document is being replaced from disk, so the change listener
  // does not queue a save of content the user did not type.
  const applying = useRef(false);

  // The per-bubble model menu: where it is anchored and which bubble it is for.
  // Coordinates are relative to .editor-wrap so the menu tracks the bubble at
  // any UI zoom level (Ctrl +/-), not just at 100%.
  const [bubbleMenu, setBubbleMenu] = useState<{
    top: number;
    left: number;
    label: string;
    below: boolean;
    text: string;
    from: number;
    to: number;
  } | null>(null);
  const [copiedBubble, setCopiedBubble] = useState(false);
  // The menu retires on its own ~1.5s after it appears, so a mouse resting in
  // the note is not left with a panel floating over the text. Held open for as
  // long as the pointer is actually inside it.
  const [menuFading, setMenuFading] = useState(false);
  const fadeTimers = useRef<number[]>([]);
  const menuHeld = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);
  // Bubble reorder drag state (pointer-based, not native HTML5 DnD): which
  // bubble is being dragged, the pointer position the drag began at, and the
  // drop boundary the pointer is currently over. `cleanup` detaches the
  // document listeners added while a drag is in progress.
  const bubbleDrag = useRef<{
    index: number;
    startX: number;
    startY: number;
    moved: boolean;
    boundary: number | null;
  } | null>(null);
  const bubbleDragCleanup = useRef<(() => void) | null>(null);
  /** Floating ghost element following the cursor while a bubble is dragged. */
  const dragGhostRef = useRef<HTMLElement | null>(null);
  const [dropAt, setDropAt] = useState<{ top: number; left: number; width: number } | null>(null);

  const cancelHide = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const clearFade = () => {
    for (const t of fadeTimers.current) clearTimeout(t);
    fadeTimers.current = [];
    setMenuFading(false);
  };
  // A short grace period so moving from the bubble up to the menu (or across a
  // heading in between) never makes the menu vanish before it is reached.
  const scheduleHide = () => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => {
      setBubbleMenu(null);
      useStore.getState().setHoverBubble(null);
    }, 250);
  };

  const copyBubble = () => {
    if (!bubbleMenu) return;
    void navigator.clipboard.writeText(bubbleMenu.text);
    setCopiedBubble(true);
    setTimeout(() => setCopiedBubble(false), 1200);
  };

  // --- pointer-based bubble reorder drag ---
  // Native HTML5 DnD from the grip fights CodeMirror's own drag handling (its
  // dragstart preventDefault leaves a "no-drop" cursor), so the reorder is done
  // with raw pointer events instead: mousedown on a grip records the bubble,
  // mousemove past a small threshold shows the drop line, mouseup commits it.

  const endBubbleDrag = (commit: boolean) => {
    const drag = bubbleDrag.current;
    bubbleDrag.current = null;
    bubbleDragCleanup.current?.();
    bubbleDragCleanup.current = null;
    document.body.classList.remove("bubble-dragging");
    dragGhostRef.current?.remove();
    dragGhostRef.current = null;
    setDropAt(null);
    if (!commit || !drag || !drag.moved || drag.boundary == null) return;
    const editor = view.current;
    if (!editor) return;
    const toIndex = drag.boundary <= drag.index ? drag.boundary : drag.boundary - 1;
    const next = reorderBubbles(editor.state, drag.index, toIndex);
    if (next != null) {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: next.body },
        selection: { anchor: next.at },
        scrollIntoView: true,
      });
      editor.focus();
    }
    setBubbleMenu(null);
    useStore.getState().setHoverBubble(null);
  };

  const onBubbleDragMove = (event: MouseEvent) => {
    const drag = bubbleDrag.current;
    if (!drag) return;
    event.preventDefault();
    // The ghost follows the cursor immediately, even before the drag threshold.
    if (dragGhostRef.current) {
      const zoom = getUiZoom();
      dragGhostRef.current.style.left = `${viewportToLayout(event.clientX, zoom)}px`;
      dragGhostRef.current.style.top = `${viewportToLayout(event.clientY, zoom)}px`;
    }
    // A small threshold so a plain click on the grip never starts a drag.
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) {
      return;
    }
    drag.moved = true;
    const editor = view.current;
    if (!editor) return;
    const boundary = bubbleBoundaryAt(editor, event.clientX, event.clientY);
    drag.boundary = boundary;
    if (boundary == null) {
      setDropAt(null);
      return;
    }
    const bubbles = computeBubbles(editor.state);
    const n = bubbles.length;
    const toIndex = boundary <= drag.index ? boundary : boundary - 1;
    if (toIndex === drag.index) {
      setDropAt(null);
      return;
    }
    const anchor = boundary < n ? bubbles[boundary].from : bubbles[n - 1].to;
    const line = lineElementAt(editor, anchor);
    const wrap = wrapRef.current;
    if (!line || !wrap) {
      setDropAt(null);
      return;
    }
    const rect = line.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const contentRect = editor.contentDOM.getBoundingClientRect();
    const zoom = getUiZoom();
    const top = ((boundary < n ? rect.top : rect.bottom) - wrapRect.top) / zoom;
    const left = (contentRect.left - wrapRect.left) / zoom;
    const width = contentRect.width / zoom;
    setDropAt((current) =>
      current && current.top === top && current.left === left && current.width === width
        ? current
        : { top, left, width },
    );
  };

  const onBubbleDragUp = (event: MouseEvent) => {
    if (!bubbleDrag.current) return;
    event.preventDefault();
    endBubbleDrag(true);
  };

  const startBubbleDrag = (clientX: number, clientY: number, index: number) => {
    const editor = view.current;
    const bubbles = editor ? computeBubbles(editor.state) : [];
    const label =
      editor && bubbles[index] ? editor.state.doc.lineAt(bubbles[index].from).text.trim() : "";
    bubbleDrag.current = {
      index,
      startX: clientX,
      startY: clientY,
      moved: false,
      boundary: null,
    };
    document.body.classList.add("bubble-dragging");
    // A floating ghost of the bubble's first line follows the cursor so it is
    // obvious which bubble is being picked up.
    const ghost = document.createElement("div");
    ghost.className = "bubble-drag-ghost";
    ghost.textContent = label;
    const zoom = getUiZoom();
    ghost.style.left = `${viewportToLayout(clientX, zoom)}px`;
    ghost.style.top = `${viewportToLayout(clientY, zoom)}px`;
    document.body.appendChild(ghost);
    dragGhostRef.current = ghost;
    setBubbleMenu(null);
    useStore.getState().setHoverBubble(null);
    const onMove = (e: MouseEvent) => onBubbleDragMove(e);
    const onUp = (e: MouseEvent) => onBubbleDragUp(e);
    const onBlur = () => endBubbleDrag(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") endBubbleDrag(false);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    bubbleDragCleanup.current = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  };

  const onEditorMouseMove = (event: React.MouseEvent) => {
    if (useStore.getState().active?.type !== "idea") {
      setBubbleMenu(null);
      useStore.getState().setHoverBubble(null);
      return;
    }
    // A bubble reorder drag is in progress — don't open the hover menu.
    if (bubbleDrag.current) return;
    // Over the menu or its dropdown: keep it open.
    if (menuRef.current?.contains(event.target as Node)) {
      cancelHide();
      return;
    }
    const line = paraLineOf(event.target);
    if (!line) {
      scheduleHide();
      return;
    }
    const editor = view.current;
    if (!editor) return;
    const first = bubbleFirstLine(line);
    const pos = editor.posAtDOM(first, 0);
    const label = editor.state.doc.lineAt(pos).text.trim();
    if (!label) {
      scheduleHide();
      return;
    }
    const bubble = computeBubbles(editor.state).find((b) => pos >= b.from && pos < b.to);
    const docLine = editor.state.doc.lineAt(pos);
    const text = bubble ? editor.state.doc.sliceString(bubble.from, bubble.to) : docLine.text;
    const from = bubble ? bubble.from : docLine.from;
    const to = bubble ? bubble.to : docLine.to;
    cancelHide();
    useStore.getState().setHoverBubble(label);
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = first.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    // Absolute offsets are layout pixels that scale with the UI zoom (Ctrl +/-),
    // so convert the visual viewport deltas back into that space first.
    const zoom = getUiZoom();
    // Just above the bubble, or just below it when there is no room up there.
    const below = rect.top < 120;
    const top = ((below ? rect.bottom : rect.top) - wrapRect.top) / zoom;
    const left = (rect.left - wrapRect.left) / zoom;
    setBubbleMenu((current) => {
      if (
        current &&
        current.label === label &&
        current.below === below &&
        current.from === from &&
        current.to === to &&
        Math.abs(current.top - top) < 1 &&
        Math.abs(current.left - left) < 1
      ) {
        return current;
      }
      return { top, left, label, below, text, from, to };
    });
  };

  /** Remove the hovered bubble, optionally copying it first (cut). The blank
   *  line that separated it goes too, so the note does not accumulate gaps;
   *  Ctrl+Z puts the whole thing back. */
  const removeBubble = (cut: boolean) => {
    const editor = view.current;
    if (!editor || !bubbleMenu) return;
    if (cut) void navigator.clipboard.writeText(bubbleMenu.text);

    const text = editor.state.doc.toString();
    let { from, to } = bubbleMenu;
    const after = /^\n[ \t]*\n/.exec(text.slice(to));
    if (after) {
      to += after[0].length;
    } else {
      const before = /\n[ \t]*\n$/.exec(text.slice(0, from));
      if (before) from -= before[0].length;
    }

    editor.dispatch({
      changes: { from, to, insert: "" },
      selection: { anchor: Math.min(from, editor.state.doc.length - (to - from)) },
      scrollIntoView: true,
    });
    setBubbleMenu(null);
    useStore.getState().setHoverBubble(null);
    editor.focus();
  };

  const onEditorMouseLeave = () => scheduleHide();

  // Fade out at 1.3s, gone at 1.5s. Restarted whenever the menu moves to
  // another bubble, because `bubbleMenu` keeps its identity while it stays put.
  useEffect(() => {
    clearFade();
    if (!bubbleMenu) return;
    const fade = window.setTimeout(() => {
      if (!menuHeld.current) setMenuFading(true);
    }, 1300);
    const gone = window.setTimeout(() => {
      if (menuHeld.current) return;
      setBubbleMenu(null);
      useStore.getState().setHoverBubble(null);
    }, 1500);
    fadeTimers.current = [fade, gone];
    return () => {
      clearTimeout(fade);
      clearTimeout(gone);
    };
  }, [bubbleMenu]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  // Hover tint for the idea bubbles, driven by the note's first tag color.
  const paraHover = useMemo(
    () => (active?.tags?.[0] ? tagHoverColor(active.tags[0]) : "rgba(255,255,255,0.06)"),
    [active?.tags],
  );

  useEffect(() => {
    if (!host.current) return;

    const extensions: Extension[] = [
      history(),
      drawSelection(),
          // Typing a bracket over a selection wraps it instead of replacing it,
          // so `[` twice on a word gives [[word]].
          closeBrackets(),
          autocompletion({
            override: [wikiLinkCompletionSource],
            defaultKeymap: true,
            icons: false,
          }),
          EditorView.lineWrapping,
          markdown(),
          syntaxHighlighting(markdownHighlightStyle, { fallback: true }),
          wikiLinks,
          headings,
          paragraphBoxes,
          heatBars,
          placeholders,
          bubbleHover,
          findPlugin,
          theme,
          // Take precedence over CodeMirror's own Mod-f search binding.
          Prec.highest(
            keymap.of([
              {
                // closeBrackets does the wrapping, one pair per press; this
                // only stops it once the word is five deep.
                key: "[",
                run: limitBracketWrap,
              },
              {
                // Ahead of the default binding, which would take the whole
                // wrapped word rather than one level of it.
                key: "Backspace",
                run: peelBrackets,
              },
              {
                key: "Mod-Enter",
                run: () => {
                  if (!useStore.getState().active?.collection) return false;
                  void useStore.getState().returnToCollection();
                  return true;
                },
              },
              {
                key: "Mod-f",
                run: () => (useStore.getState().setPalette(true), true),
              },
              {
                key: "Mod-Shift-f",
                run: () => (useStore.getState().openFind(), true),
              },
              {
                key: "Mod-k",
                run: () => (useStore.getState().setPalette(true), true),
              },
              {
                key: "Mod-s",
                run: () => (void useStore.getState().flushSave(), true),
              },
              {
                // historyKeymap only binds Mod-Shift-z on macOS; Windows and
                // Linux are left with Mod-y alone. Bind both everywhere so
                // either muscle memory redoes.
                key: "Mod-Shift-z",
                run: redo,
                preventDefault: true,
              },
              {
                // In an idea, select just the bubble the cursor is in; outside
                // a bubble (e.g. a blank line) fall through to select-all.
                key: "Mod-a",
                run: (view) => {
                  if (useStore.getState().active?.type !== "idea") return false;
                  const head = view.state.selection.main.head;
                  const bubble = computeBubbles(view.state).find(
                    (b) => head >= b.from && head <= b.to && b.from !== b.to,
                  );
                  if (!bubble) return false;
                  view.dispatch({
                    selection: { anchor: bubble.from, head: bubble.to },
                    scrollIntoView: true,
                  });
                  return true;
                },
              },
            ]),
          ),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
          EditorView.domEventHandlers({
            // A long paste may be a batch of prompts. Let it land normally,
            // then offer to split it — the offer is silent unless the text
            // actually has two or more sections.
            paste: (event, view) => {
              const text = event.clipboardData?.getData("text/plain") ?? "";
              const active = useStore.getState().active;
              // Importing a text file into an idea: normalize it into separate
              // paragraphs so the note's bubbles form cleanly.
              if (active?.type === "idea" && text.trim()) {
                const normalized = normalizePastedText(text);
                if (normalized !== text) {
                  event.preventDefault();
                  const { from, to } = view.state.selection.main;
                  view.dispatch({ changes: { from, to, insert: normalized } });
                  return true;
                }
              }
              return false;
            },
            mousedown: (event) => {
              // Note: a grip's mousedown is handled on the grip element itself
              // (see BubbleGripWidget), so it never reaches here.
              if (!event.ctrlKey && !event.metaKey) return false;
              const link = (event.target as HTMLElement).closest(".cm-wikilink");
              const target = link?.getAttribute("data-target");
              if (!target) return false;
              event.preventDefault();
              void useStore.getState().openLink(target);
              return true;
            },
            // Replace the webview's default menu with linking actions.
            contextmenu: (event, view) => {
              event.preventDefault();
              event.stopPropagation();
              const link = (event.target as HTMLElement)
                .closest(".cm-wikilink")
                ?.getAttribute("data-target");
              useStore.getState().openMenu({
                x: event.clientX,
                y: event.clientY,
                hasSelection: !view.state.selection.main.empty,
                link: link ?? null,
              });
              return true;
            },
          }),
          EditorView.updateListener.of((update) => {
            // The bubble the caret sits in, so the right panel can follow it
            // when the mouse is not hovering one.
            if (update.docChanged || update.selectionSet) {
              const store = useStore.getState();
              store.setCursorBubble(
                store.active?.type === "idea"
                  ? bubbleLabelAt(update.state, update.state.selection.main.head)
                  : null,
              );
            }
            // Typing dismisses the hover menu — the note is being worked in,
            // not hovered. Skips programmatic replacements (loading a note).
            if (update.docChanged && !applying.current) {
              setBubbleMenu(null);
              useStore.getState().setHoverBubble(null);
            }
            if (!update.docChanged || applying.current) return;
            const id = activeId.current;
            if (id) useStore.getState().queueSave(id, update.state.doc.toString());
          }),
    ];
    extensionsRef.current = extensions;

    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({ doc: "", extensions }),
    });

    view.current = editor;

    // Widgets are built outside React, so the grip's mousedown reaches this
    // component through the module-level bridge.
    gripDragStart.onDown = (from, x, y) => {
      const current = view.current;
      if (!current) return;
      const index = computeBubbles(current.state).findIndex(
        (b) => current.state.doc.lineAt(b.from).from === from,
      );
      if (index < 0) return;
      startBubbleDrag(x, y, index);
    };

    return () => {
      gripDragStart.onDown = null;
      endBubbleDrag(false);
      editor.destroy();
      view.current = null;
    };
  }, []);

  // Load the selected note's text. Keyed on id (not the object) so ordinary
  // saves do not disturb the cursor; docVersion forces a reload after an
  // external change.
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;

    activeId.current = active?.id ?? null;
    setBubbleMenu(null);
    applying.current = true;
    editor.setState(
      EditorState.create({
        doc: active?.body ?? "",
        selection: { anchor: 0 },
        extensions: extensionsRef.current,
      }),
    );
    applying.current = false;
    if (active) editor.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, docVersion]);

  // A note was chosen from the link picker: drop [[Title]] over the selection.
  useEffect(() => {
    const editor = view.current;
    if (!editor || !insertLink) return;

    const { from, to } = editor.state.selection.main;
    const text = `[[${insertLink}]]`;
    editor.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
    editor.focus();
    useStore.getState().requestLink(null);
  }, [insertLink]);

  // An idea's paragraph was picked from the sidebar outline: jump to it.
  useEffect(() => {
    const editor = view.current;
    if (!editor || !scrollTo) return;
    if (scrollTo.id !== activeId.current) return;
    editor.dispatch({ selection: { anchor: scrollTo.pos }, scrollIntoView: true });
    editor.focus();
    useStore.getState().clearScroll();
  }, [scrollTo]);

  // Any find change reaches the editor's match-highlighting plugin.
  useEffect(() => {
    view.current?.dispatch({ effects: findEffect.of(useStore.getState().find) });
  }, [find]);

  return (
    <div
      ref={wrapRef}
      className="editor-wrap"
      onMouseMove={onEditorMouseMove}
      onMouseLeave={onEditorMouseLeave}
      onMouseDown={(event) => {
        if (!menuRef.current?.contains(event.target as Node)) setBubbleMenu(null);
      }}
    >
      <div
        className="editor"
        ref={host}
        style={{ "--para-hover": paraHover } as React.CSSProperties}
      />

      {bubbleMenu && active?.type === "idea" && (
        <div
          ref={menuRef}
          className={menuFading ? "bubble-model-menu fading" : "bubble-model-menu"}
          style={{
            top: bubbleMenu.top,
            left: bubbleMenu.left,
            transform: bubbleMenu.below ? "none" : "translateY(-100%)",
          }}
          onMouseEnter={() => {
            menuHeld.current = true;
            cancelHide();
            clearFade();
          }}
          onMouseLeave={() => {
            menuHeld.current = false;
            scheduleHide();
          }}
        >
          <div className="bubble-model-row">
            <ModelPicker
              value={active.models?.[bubbleMenu.label] ?? ""}
              onChange={(value) =>
                void useStore.getState().setBubbleModel(bubbleMenu.label, value || null)
              }
            />
            <button
              className="bubble-model-copy"
              data-tooltip="Copy bubble"
              onClick={copyBubble}
              onMouseDown={(event) => event.stopPropagation()}
            >
              {copiedBubble ? "✓" : "⧉"}
            </button>
            <button
              className="bubble-model-copy"
              data-tooltip="Cut bubble"
              onClick={() => removeBubble(true)}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="4.6" cy="11.4" r="1.6" />
                <circle cx="11.4" cy="11.4" r="1.6" />
                <path d="M5.7 10.1 12.4 3M10.3 10.1 3.6 3" />
              </svg>
            </button>
            <button
              className="bubble-model-copy danger"
              data-tooltip="Delete bubble"
              onClick={() => removeBubble(false)}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2.8 5h10.4M6.3 5V3h3.4v2M4.4 5l.7 8h5.8l.7-8" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {dropAt && (
        <div
          className="bubble-drop-indicator"
          style={{ top: dropAt.top, left: dropAt.left, width: dropAt.width }}
        />
      )}

      {find && (
        <div className="find-bar" role="search">
          <input
            autoFocus
            value={find.query}
            placeholder="Find in this note…"
            onChange={(event) => setFindQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                findMove(event.shiftKey ? -1 : 1);
              } else if (event.key === "Escape") {
                event.preventDefault();
                closeFind();
              }
            }}
          />
          <span className="find-count">
            {findCount > 0 ? `${Math.min(find.index + 1, findCount)} / ${findCount}` : "0 / 0"}
          </span>
          <button
            className="find-nav"
            data-tooltip="Previous (Shift+Enter)"
            onClick={() => findMove(-1)}
          >
            ↑
          </button>
          <button className="find-nav" data-tooltip="Next (Enter)" onClick={() => findMove(1)}>
            ↓
          </button>
          <button className="find-close" data-tooltip="Close (Esc)" onClick={closeFind}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
