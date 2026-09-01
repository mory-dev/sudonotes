import { afterEach, describe, expect, it } from "vitest";
import { closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  isolateHistory,
  history,
    historyKeymap,
  redo,
  redoSelection,
  undo,
  undoSelection,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import { editorBridge, useStore } from "../store";
import { EditorStateCache, editorStateCache } from "../editorStateCache";
import {
  buildHistoryKey,
  deserializeHistoryState,
  serializeHistoryState,
} from "../historyStorage";
import {
  bubbleForModA,
  bubbleOpEffect,
  bubbleTagsForLabel,
  computeBubbles,
  inferBubbleTags,
  modABinding,
  reorderBubbles,
} from "./Editor";

/** A minimal idea-note editor with history, bubble operations, and keymaps. */
function makeView(doc: string): EditorView {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [
        history({ minDepth: 150, newGroupDelay: 500 }),
        markdown(),
        Prec.highest(
          keymap.of([
            { key: "Mod-z", run: undo, preventDefault: true },
            { key: "Mod-y", run: redo, preventDefault: true },
            { key: "Mod-Shift-z", run: redo, preventDefault: true },
            { key: "Mod-u", run: undoSelection, preventDefault: true },
            { key: "Alt-u", run: redoSelection, preventDefault: true },
            { key: "Mod-Shift-u", run: redoSelection, preventDefault: true },
            modABinding,
          ]),
        ),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
      ],
    }),
  });
}

function pressA(view: EditorView) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true }),
  );
}

const DOC = "First bubble\n\nSecond bubble\n\nThird bubble";

afterEach(() => {
  useStore.setState({ active: null });
  editorStateCache.clear();
  editorBridge.deleteBubbleAt = undefined;
  editorBridge.moveBubble = undefined;
  document.body.innerHTML = "";
});

describe("bubbleForModA", () => {
  const bubbles = [
    { from: 0, to: 12 },
    { from: 14, to: 27 },
  ];

  it("returns the caret's own bubble", () => {
    expect(bubbleForModA(20, 20, 20, bubbles)).toEqual({ from: 14, to: 27 });
  });

  it("returns null when the whole bubble is already selected, so the next press selects all", () => {
    expect(bubbleForModA(27, 14, 27, bubbles)).toBeNull();
  });

  it("returns null when the caret is outside any bubble (e.g. a blank separator)", () => {
    expect(bubbleForModA(13, 13, 13, bubbles)).toBeNull();
  });

  it("skips empty bubbles", () => {
    expect(bubbleForModA(30, 30, 30, [...bubbles, { from: 30, to: 30 }])).toBeNull();
  });
});

describe("idea bubble metadata", () => {
  it("discovers bubbles across the full document, not just the initial viewport", () => {
    const doc = Array.from({ length: 40 }, (_, index) => `Bubble ${index + 1}`).join("\n\n");
    const state = EditorState.create({ doc, extensions: [markdown()] });
    expect(computeBubbles(state)).toHaveLength(40);
  });

  it("does not copy note-level tags into an untagged bubble", () => {
    const tags = { "Tagged bubble": ["design"] };
    expect(bubbleTagsForLabel(tags, "Tagged bubble")).toEqual(["design"]);
    expect(bubbleTagsForLabel(tags, "Other bubble")).toEqual([]);
  });

  it("derives only relevant note tags for legacy bubbles without explicit tags", () => {
    expect(inferBubbleTags(["bug", "design", "workflow"], "Fix the broken UI issue")).toEqual([
      "bug",
      "design",
    ]);
    expect(inferBubbleTags(["bug", "design"], "A grocery list")).toEqual([]);
  });
});

describe("Ctrl+A in an idea note", () => {
  it("selects the caret's bubble on the first press and the whole note on the second", () => {
    useStore.setState({ active: { type: "idea" } as never });
    const view = makeView(DOC);
    const bubbleStart = DOC.indexOf("Second bubble");
    view.dispatch({ selection: { anchor: bubbleStart + 2 } });

    // First press: just the bubble.
    pressA(view);
    expect(view.state.selection.main.from).toBe(bubbleStart);
    expect(view.state.selection.main.to).toBe(bubbleStart + "Second bubble".length);

    // Second press: the whole note.
    pressA(view);
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(DOC.length);
  });

  it("falls through to select-all straight away when the caret is on a blank separator", () => {
    useStore.setState({ active: { type: "idea" } as never });
    const view = makeView(DOC);
    view.dispatch({ selection: { anchor: DOC.indexOf("\n\n") + 1 } });

    pressA(view);
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(DOC.length);
  });
});

describe("Tier-1 EditorStateCache", () => {
  it("stores and retrieves EditorState and scroll position", () => {
    const cache = new EditorStateCache(50);
    const state = EditorState.create({ doc: "Note A content" });
    cache.set("note-a", { state, scrollTop: 120 });

    expect(cache.has("note-a")).toBe(true);
    const cached = cache.get("note-a");
    expect(cached).toBeDefined();
    expect(cached?.state.doc.toString()).toBe("Note A content");
    expect(cached?.scrollTop).toBe(120);
  });

  it("enforces LRU cap of 50 notes by evicting the least recently used", () => {
    const cache = new EditorStateCache(50);
    for (let i = 1; i <= 50; i++) {
      cache.set(`note-${i}`, {
        state: EditorState.create({ doc: `Content ${i}` }),
        scrollTop: i * 10,
      });
    }
    expect(cache.size).toBe(50);
    expect(cache.has("note-1")).toBe(true);

    // Access note-1 to refresh its LRU timestamp
    cache.get("note-1");

    // Add note-51: note-2 (the oldest unaccessed) should be evicted, not note-1
    cache.set("note-51", {
      state: EditorState.create({ doc: "Content 51" }),
      scrollTop: 510,
    });

    expect(cache.size).toBe(50);
    expect(cache.has("note-1")).toBe(true);
    expect(cache.has("note-2")).toBe(false);
    expect(cache.has("note-51")).toBe(true);
  });
});

describe("Multi-note switching preserves undo/redo stacks", () => {
  it("preserves separate undo histories when switching between notes via cache", () => {
    const extensions = [history({ minDepth: 150, newGroupDelay: 500 })];
    const cache = new EditorStateCache(50);

    // Note 1: start with "Hello", type " World"
    let state1 = EditorState.create({ doc: "Hello", extensions });
    state1 = state1.update({ changes: { from: 5, insert: " World" } }).state;
    expect(state1.doc.toString()).toBe("Hello World");
    cache.set("note-1", { state: state1, scrollTop: 0 });

    // Note 2: start with "Alpha", type " Beta"
    let state2 = EditorState.create({ doc: "Alpha", extensions });
    state2 = state2.update({ changes: { from: 5, insert: " Beta" } }).state;
    expect(state2.doc.toString()).toBe("Alpha Beta");
    cache.set("note-2", { state: state2, scrollTop: 0 });

    // Switch back to Note 1: restore state and undo
    const restored1 = cache.get("note-1")!.state;
    expect(restored1.doc.toString()).toBe("Hello World");
    const view1 = new EditorView({ state: restored1 });
    undo(view1);
    expect(view1.state.doc.toString()).toBe("Hello");
    redo(view1);
    expect(view1.state.doc.toString()).toBe("Hello World");

    // Switch back to Note 2: restore state and undo
    const restored2 = cache.get("note-2")!.state;
    expect(restored2.doc.toString()).toBe("Alpha Beta");
    const view2 = new EditorView({ state: restored2 });
    undo(view2);
    expect(view2.state.doc.toString()).toBe("Alpha");
    redo(view2);
    expect(view2.state.doc.toString()).toBe("Alpha Beta");
  });

  it("updates cached state with changes when note content modified externally while keeping history", () => {
    const extensions = [history({ minDepth: 150, newGroupDelay: 500 })];
    let state = EditorState.create({ doc: "Initial", extensions });
    state = state.update({ changes: { from: 7, insert: " text" } }).state;
    expect(state.doc.toString()).toBe("Initial text");

    // External change on disk modifies document to "External text"
    const externalDoc = "External text";
    const updated = state.update({
      changes: { from: 0, to: state.doc.length, insert: externalDoc },
    }).state;
    expect(updated.doc.toString()).toBe("External text");

    // Undo should still revert the previous user edit
    const view = new EditorView({ state: updated });
    undo(view);
    expect(view.state.doc.toString()).not.toBe("External text");
  });
});

describe("Non-destructive undoable bubble operations", () => {
  it("undoes bubble deletion via Ctrl+Z without wiping history", () => {
    const initialDoc = "First bubble\n\nSecond bubble\n\nThird bubble";
    const view = makeView(initialDoc);

    // Initial edit to populate history
    view.dispatch({ changes: { from: 12, insert: " updated" } });
    expect(view.state.doc.toString()).toBe("First bubble updated\n\nSecond bubble\n\nThird bubble");

    // Delete "Second bubble"
    const secondStart = view.state.doc.toString().indexOf("Second bubble");
    const body = view.state.doc.toString();
    const rest = body.slice(secondStart);
    const gap = /\n[ \t]*\n/.exec(rest);
    const from = secondStart;
    const to = gap ? secondStart + gap.index + gap[0].length : body.length;

    view.dispatch({
      changes: { from, to, insert: "" },
      effects: bubbleOpEffect.of(null),
    });

    expect(view.state.doc.toString()).toBe("First bubble updated\n\nThird bubble");

    // Undo deletion
    undo(view);
    expect(view.state.doc.toString()).toBe("First bubble updated\n\nSecond bubble\n\nThird bubble");

    // Undo previous text edit
    undo(view);
    expect(view.state.doc.toString()).toBe("First bubble\n\nSecond bubble\n\nThird bubble");

    // Redo both
    redo(view);
    expect(view.state.doc.toString()).toBe("First bubble updated\n\nSecond bubble\n\nThird bubble");
    redo(view);
    expect(view.state.doc.toString()).toBe("First bubble updated\n\nThird bubble");
  });

  it("undoes bubble move / reorder via Ctrl+Z without wiping history", () => {
    const initialDoc = "Bubble 1\n\nBubble 2\n\nBubble 3";
    const view = makeView(initialDoc);

    // Move Bubble 0 to index 2 (Bubble 1 to the end)
    const reordered = reorderBubbles(view.state, 0, 2);
    expect(reordered).not.toBeNull();
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: reordered!.body },
      selection: { anchor: reordered!.at },
      effects: bubbleOpEffect.of(null),
    });

    expect(view.state.doc.toString()).toBe("Bubble 2\n\nBubble 3\n\nBubble 1");

    // Undo the move
    undo(view);
    expect(view.state.doc.toString()).toBe("Bubble 1\n\nBubble 2\n\nBubble 3");

    // Redo the move
    redo(view);
    expect(view.state.doc.toString()).toBe("Bubble 2\n\nBubble 3\n\nBubble 1");
  });

  it("executes deleteBubbleAt and moveBubble through editorBridge", () => {
    const initialDoc = "Bubble A\n\nBubble B\n\nBubble C";
    const view = makeView(initialDoc);

    useStore.setState({ active: { id: "test-note", type: "idea", body: initialDoc } as never });

    // Register bridge handlers matching Editor.tsx
    editorBridge.deleteBubbleAt = (start: number) => {
      const body = view.state.doc.toString();
      if (start < 0 || start >= body.length) return false;
      const rest = body.slice(start);
      const gap = /\n[ \t]*\n/.exec(rest);
      let from = start;
      const to = gap ? start + gap.index + gap[0].length : body.length;
      if (!gap) {
        const before = /\n[ \t]*\n$/.exec(body.slice(0, start));
        if (before) from -= before[0].length;
      }
      view.dispatch({
        changes: { from, to, insert: "" },
        effects: bubbleOpEffect.of(null),
      });
      return true;
    };

    editorBridge.moveBubble = (fromIndex: number, toIndex: number) => {
      const next = reorderBubbles(view.state, fromIndex, toIndex);
      if (!next) return false;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next.body },
        effects: bubbleOpEffect.of(null),
      });
      return true;
    };

    // Trigger delete via store action
    const bubbleBStart = initialDoc.indexOf("Bubble B");
    useStore.getState().deleteBubbleAt(bubbleBStart);
    expect(view.state.doc.toString()).toBe("Bubble A\n\nBubble C");

    // Undo should restore Bubble B
    undo(view);
    expect(view.state.doc.toString()).toBe("Bubble A\n\nBubble B\n\nBubble C");

    // Trigger move via store action
    useStore.getState().moveBubble(0, 1);
    expect(view.state.doc.toString()).toBe("Bubble B\n\nBubble A\n\nBubble C");

    // Undo should restore original order
    undo(view);
    expect(view.state.doc.toString()).toBe("Bubble A\n\nBubble B\n\nBubble C");
  });
});

describe("Tier-2 History Persistence & Serialization", () => {
  it("serializes and deserializes EditorState with historyField preserving undo/redo", () => {
    const extensions = [history({ minDepth: 150, newGroupDelay: 500 })];
    let state = EditorState.create({ doc: "Draft idea", extensions });

    // Type 1
    state = state.update({ changes: { from: 10, insert: " #1" } }).state;
    // Type 2 (isolated history group)
    state = state.update({
      changes: { from: 13, insert: " extra" },
      annotations: isolateHistory.of("before"),
    }).state;
    expect(state.doc.toString()).toBe("Draft idea #1 extra");

    // Serialize
    const { historyJSON, doc, scrollTop } = serializeHistoryState(state, 85);
    expect(doc).toBe("Draft idea #1 extra");
    expect(scrollTop).toBe(85);
    expect(historyJSON).toHaveProperty("history");

    // Deserialize
    const restored = deserializeHistoryState(historyJSON, extensions);
    expect(restored).not.toBeNull();
    expect(restored!.doc.toString()).toBe("Draft idea #1 extra");

    const view = new EditorView({ state: restored! });

    // Undo step 2
    undo(view);
    expect(view.state.doc.toString()).toBe("Draft idea #1");

    // Undo step 1
    undo(view);
    expect(view.state.doc.toString()).toBe("Draft idea");

    // Redo step 1
    redo(view);
    expect(view.state.doc.toString()).toBe("Draft idea #1");

    // Redo step 2
    redo(view);
    expect(view.state.doc.toString()).toBe("Draft idea #1 extra");
  });

  it("builds correct history keys", () => {
    expect(buildHistoryKey("/path/to/vault", "note-123")).toBe("sudonotes:history:/path/to/vault:note-123");
    expect(buildHistoryKey("", "note-456")).toBe("sudonotes:history:default:note-456");
    expect(buildHistoryKey(null, "note-789")).toBe("sudonotes:history:default:note-789");
  });
});
