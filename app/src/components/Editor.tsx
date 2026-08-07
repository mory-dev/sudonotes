import { useEffect, useMemo, useRef } from "react";

import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  defaultHighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import { EditorState, Prec, RangeSetBuilder, StateEffect, type Text } from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  keymap,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

import { useStore } from "../store";
import { tagHoverColor } from "../tagColors";

/** Split pasted text into clean paragraphs (separated by a single blank line)
 *  so an imported notepad-style file becomes distinct idea bubbles. */
function normalizePastedText(text: string): string {
  const groups = text.split(/\n\s*\n/).map((g) => g.trim()).filter(Boolean);
  if (groups.length <= 1) return text;
  return `${groups.join("\n\n")}\n`;
}

const WIKILINK = /\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g;
const recentWraps = new WeakMap<EditorView, { position: number; until: number }>();

/** Hides the syntax so a link reads as ordinary highlighted text. */
const hidden = Decoration.replace({});

const label = (target: string) =>
  Decoration.mark({
    class: "cm-wikilink",
    attributes: {
      "data-target": target,
      title: `Ctrl+click to open "${target}"`,
    },
  });

/**
 * Render `[[Target]]` as just `Target`, highlighted — the brackets only appear
 * while the cursor is inside the link, so it stays editable without ever
 * showing markup you did not ask to see.
 */
function buildLinkDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const cursor = view.state.selection.main;

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    WIKILINK.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = WIKILINK.exec(text))) {
      const start = from + match.index;
      const end = start + match[0].length;
      const target = match[1].trim();
      const alias = match[2];

      // Reveal the raw syntax when the caret is in or beside the link.
      if (cursor.from <= end && cursor.to >= start) {
        builder.add(start, end, label(target));
        continue;
      }

      builder.add(start, start + 2, hidden);
      const inner = start + 2;
      const closing = end - 2;

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

/** Wrap each idea in the note in a subtle box: a paragraph together with any
 *  list or quote that follows it directly forms one bubble. Only applied to
 *  idea notes; prompt children keep the bare editor. */
function buildParagraphDecorations(view: EditorView): DecorationSet {
  if (useStore.getState().active?.type !== "idea") {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  // Group top-level blocks into bubbles: paragraphs, lists, and quotes merge
  // as long as no blank line separates them; headings and code break a bubble.
  const runs: { from: number; to: number }[] = [];
  let run: { from: number; to: number } | null = null;
  const top = syntaxTree(view.state).topNode;
  for (let node = top.firstChild; node; node = node.nextSibling) {
    const name = node.name;
    const boxable =
      name === "Paragraph" ||
      name === "BulletList" ||
      name === "OrderedList" ||
      name === "Blockquote";
    if (!boxable) {
      if (run) {
        runs.push(run);
        run = null;
      }
      continue;
    }
    if (run) {
      const gapLines = doc.lineAt(node.from).number - doc.lineAt(run.to).number;
      if (gapLines > 1) {
        runs.push(run);
        run = { from: node.from, to: node.to };
      } else {
        run.to = node.to;
      }
    } else {
      run = { from: node.from, to: node.to };
    }
  }
  if (run) runs.push(run);

  for (const block of runs) {
    const firstLine = doc.lineAt(block.from);
    const lastLine = doc.lineAt(block.to);
    for (let n = firstLine.number; n <= lastLine.number; n++) {
      const line = doc.line(n);
      const classes = [
        "cm-para",
        n === firstLine.number ? "first" : "",
        n === lastLine.number ? "last" : "",
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
        view.dispatch({
          effects: EditorView.scrollIntoView(this.matches[index].from, { y: "center" }),
        });
      }
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
function wrapSelection(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  if (from === to) {
    const recent = recentWraps.get(view);
    if (recent && recent.position === from && recent.until > Date.now()) {
      recentWraps.delete(view);
      return true;
    }
    return false;
  }
  const selected = view.state.sliceDoc(from, to);
  const inserted = `[[${selected}]]`;
  view.dispatch({
    changes: { from, to, insert: inserted },
    selection: { anchor: from + inserted.length },
  });
  recentWraps.set(view, { position: from + inserted.length, until: Date.now() + 350 });
  return true;
}

const theme = EditorView.theme(
  {
    "&": { height: "100%", fontSize: "15px", backgroundColor: "transparent" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.7",
      padding: "8px 0 40vh",
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
    ".cm-heading1": { fontSize: "1.6em", fontWeight: 600 },
    ".cm-heading2": { fontSize: "1.4em", fontWeight: 600 },
    ".cm-heading3": { fontSize: "1.25em", fontWeight: 600 },
    ".cm-heading4": { fontSize: "1.1em", fontWeight: 600 },
    ".cm-heading5": { fontSize: "1em", fontWeight: 600 },
    ".cm-heading6": { fontSize: "0.9em", fontWeight: 600 },
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
    ".cm-para-hover": {
      backgroundColor: "var(--para-hover, rgba(255,255,255,0.06))",
      borderLeftColor: "rgba(255,255,255,0.18)",
      borderRightColor: "rgba(255,255,255,0.18)",
    },
    ".cm-para-hover.first": { borderTopColor: "rgba(255,255,255,0.18)" },
    ".cm-para-hover.last": { borderBottomColor: "rgba(255,255,255,0.18)" },
    ".cm-find-match": {
      backgroundColor: "rgba(247, 168, 42, 0.2)",
      borderRadius: "2px",
    },
    ".cm-find-match.current": {
      backgroundColor: "rgba(247, 168, 42, 0.42)",
      outline: "1px solid rgba(247, 168, 42, 0.75)",
    },
    "&.cm-editor .cm-selectionBackground, ::selection": {
      backgroundColor: "var(--selection)",
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
  // Set while the document is being replaced from disk, so the change listener
  // does not queue a save of content the user did not type.
  const applying = useRef(false);

  // Hover tint for the idea bubbles, driven by the note's first tag color.
  const paraHover = useMemo(
    () => (active?.tags?.[0] ? tagHoverColor(active.tags[0]) : "rgba(255,255,255,0.06)"),
    [active?.tags],
  );

  useEffect(() => {
    if (!host.current) return;

    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: "",
        extensions: [
          history(),
          drawSelection(),
          // Typing a bracket over a selection wraps it instead of replacing it,
          // so `[` twice on a word gives [[word]].
          closeBrackets(),
          EditorView.lineWrapping,
          markdown(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          wikiLinks,
          headings,
          paragraphBoxes,
          bubbleHover,
          findPlugin,
          theme,
          // Take precedence over CodeMirror's own Mod-f search binding.
          Prec.highest(
            keymap.of([
              {
                key: "[",
                run: wrapSelection,
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
            if (!update.docChanged || applying.current) return;
            const id = activeId.current;
            if (id) useStore.getState().queueSave(id, update.state.doc.toString());
          }),
        ],
      }),
    });

    view.current = editor;
    return () => {
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
    applying.current = true;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: active?.body ?? "" },
      selection: { anchor: 0 },
      scrollIntoView: true,
    });
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
    <div className="editor-wrap">
      <div
        className="editor"
        ref={host}
        style={{ "--para-hover": paraHover } as React.CSSProperties}
      />

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
            title="Previous (Shift+Enter)"
            onClick={() => findMove(-1)}
          >
            ↑
          </button>
          <button className="find-nav" title="Next (Enter)" onClick={() => findMove(1)}>
            ↓
          </button>
          <button className="find-close" title="Close (Esc)" onClick={closeFind}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
