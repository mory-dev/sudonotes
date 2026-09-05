import { useEffect, useRef, useState } from "react";

import {
  defaultKeymap,
  history,
  historyKeymap,
  redo,
  undo,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  defaultHighlightStyle,
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { EditorState, Prec, RangeSetBuilder, StateEffect, type Text } from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { useStore } from "../store";
import { BlackholeMark } from "./NoteMarks";

const markdownHighlightStyle = HighlightStyle.define(
  defaultHighlightStyle.specs.map((spec) =>
    spec.tag === tags.heading ? { ...spec, textDecoration: "none" } : spec,
  ),
);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "15px", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.7",
    padding: "52px 24px 40vh",
  },
  ".cm-content": { caretColor: "var(--accent)", maxWidth: "80ch" },
  ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
});

type FindState = { query: string; index: number; move: boolean } | null;
const findEffect = StateEffect.define<FindState>();

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

const findPlugin = ViewPlugin.fromClass(
  class {
    query = "";
    matches: { from: number; to: number }[] = [];
    destroyed = false;
    update(update: ViewUpdate) {
      let state: FindState | undefined;
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
        requestAnimationFrame(() => {
          if (this.destroyed) return;
          view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "center" }) });
        });
      }
    }
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

function BlackholeEmpty({ onStart }: { onStart: () => void }) {
  return (
    <div className="blank blackhole-blank" data-blackhole-empty="" onClick={onStart}>
      <div className="blank-marks">
        <span className="blank-mark blackhole" data-tooltip="Blackhole">
          <BlackholeMark />
        </span>
      </div>
      <h2>A dump for everything else</h2>
      <p className="muted">
        Scratch ideas that don&apos;t belong to a project — or never will. Nothing here is
        filed.
      </p>
      <div className="blank-actions">
        <button
          className="primary blank-blackhole"
          onClick={(event) => {
            event.stopPropagation();
            onStart();
          }}
        >
          <BlackholeMark />
          Start dumping
        </button>
      </div>
      <p className="blank-hint">Just start typing</p>
    </div>
  );
}

export function BlackholeTitleBar() {
  const dirty = useStore((s) => s.dirty);
  return (
    <header className="title-bar" data-type="blackhole">
      <span className="title-static">
        <span className="section-mark">
          <BlackholeMark />
        </span>
        Blackhole
      </span>
      <span className={dirty ? "save-state dirty" : "save-state"}>{dirty ? "Saving…" : "Saved"}</span>
    </header>
  );
}

/** Plain markdown dump editor — no bubbles, issues, project link, or wikilinks. */
export function BlackholeEditor() {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const body = useStore((s) => s.blackholeBody);
  const [started, setStarted] = useState(() => !!useStore.getState().blackholeBody.trim());
  const showEmpty = !started && !body.trim();
  const find = useStore((s) => s.find);
  const findFocus = useStore((s) => s.findFocus);
  const findCount = useStore((s) => s.findCount);
  const setFindQuery = useStore((s) => s.setFindQuery);
  const findMove = useStore((s) => s.findMove);
  const closeFind = useStore((s) => s.closeFind);

  useEffect(() => {
    if (!host.current) return;

    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: useStore.getState().blackholeBody,
        extensions: [
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          markdown(),
          syntaxHighlighting(markdownHighlightStyle, { fallback: true }),
          findPlugin,
          theme,
          keymap.of([...defaultKeymap, ...historyKeymap]),
          Prec.highest(
            keymap.of([
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
              { key: "Mod-z", run: undo, preventDefault: true },
              { key: "Mod-Shift-z", run: redo, preventDefault: true },
            ]),
          ),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            useStore.getState().queueBlackholeSave(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    if (useStore.getState().blackholeBody.trim()) editor.focus();

    return () => {
      void useStore.getState().flushBlackhole();
      editor.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    if (!find) return;
    findInput.current?.focus();
    findInput.current?.select();
  }, [findFocus]);

  useEffect(() => {
    view.current?.dispatch({ effects: findEffect.of(useStore.getState().find) });
  }, [find]);

  const begin = () => {
    setStarted(true);
    view.current?.focus();
  };

  return (
    <div className="editor-wrap">
      {showEmpty && <BlackholeEmpty onStart={begin} />}
      <div ref={host} className="editor" />
      {find && (
        <div className="find-bar" role="search">
          <input
            ref={findInput}
            autoFocus
            value={find.query}
            placeholder="Find in this dump…"
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
