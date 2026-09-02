import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
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
  BUBBLE_MENU_CLEARANCE,
  BUBBLE_MENU_GAP,
  bubbleFirstLine,
  bubbleForModA,
  bubbleLastLine,
  bubbleMetadataDecorations,
  bubbleModelPersistence,
  bubbleOpEffect,
  bubbleTagsForLabel,
  buildDividerDecorations,
  buildHeatDecorations,
  computeBubbleMenuPosition,
  computeBubbles,
  Editor,
  getDividerType,
  getFrontmatterEndLine,
  inferBubbleTags,
  isLineSelected,
  modABinding,
  normalizeBubbleKey,
  reorderBubbles,
  resolveBubbleModel,
  resolveBubbleTags,
  dividerAutoBreak,
  visualDividers,
} from "./Editor";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  useStore.setState({ active: null, hoverBubble: null });
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

describe("first bubble header hover occlusion & positioning", () => {
  it("bubbleFirstLine and bubbleLastLine navigate the full extent of a multi-line bubble", () => {
    const parent = document.createElement("div");
    const line1 = document.createElement("div");
    line1.className = "cm-line cm-para first cm-bubble-header";
    const line2 = document.createElement("div");
    line2.className = "cm-line cm-para";
    const line3 = document.createElement("div");
    line3.className = "cm-line cm-para last";
    const separator = document.createElement("div");
    separator.className = "cm-line";

    parent.appendChild(line1);
    parent.appendChild(line2);
    parent.appendChild(line3);
    parent.appendChild(separator);

    expect(bubbleFirstLine(line2)).toBe(line1);
    expect(bubbleFirstLine(line3)).toBe(line1);
    expect(bubbleFirstLine(line1)).toBe(line1);

    expect(bubbleLastLine(line1)).toBe(line3);
    expect(bubbleLastLine(line2)).toBe(line3);
    expect(bubbleLastLine(line3)).toBe(line3);
  });

  it("positions hover menu above the first bubble when top clearance is available", () => {
    expect(BUBBLE_MENU_CLEARANCE).toBe(44);
    // Top clearance of 52px gives relTop = 52px >= 44px
    const wrapRect = { top: 60, left: 200 };
    const firstRect = { top: 112, bottom: 144, left: 224 }; // relTop = 52, height = 32 (e.g. # Header)
    const lastRect = { top: 144, bottom: 172, left: 224 };  // multi-line bubble

    const pos = computeBubbleMenuPosition(firstRect, lastRect, wrapRect, 1);
    expect(pos.below).toBe(false);
    expect(pos.top).toBe(52 - BUBBLE_MENU_GAP); // 46px: completely above firstRect.top (52px)
    expect(pos.left).toBe(24);
  });

  it("positions hover menu below the entire bubble (after last line) when scrolled and clearance is insufficient", () => {
    // Scrolled state: first line is partially off-screen at top (relTop < BUBBLE_MENU_CLEARANCE)
    const wrapRect = { top: 60, left: 200 };
    const firstRect = { top: 70, bottom: 98, left: 224 };  // relTop = 10 < 44
    const lastRect = { top: 120, bottom: 150, left: 224 }; // relBottom = 90

    const pos = computeBubbleMenuPosition(firstRect, lastRect, wrapRect, 1);
    expect(pos.below).toBe(true);
    expect(pos.top).toBe(90 + BUBBLE_MENU_GAP); // 96px: placed cleanly below the entire bubble
    expect(pos.left).toBe(24);
  });

  it("scales positioning properly across different UI zoom levels", () => {
    const wrapRect = { top: 80, left: 100 };
    const firstRect = { top: 144, bottom: 176, left: 130 }; // visual delta: top +64, left +30
    const lastRect = { top: 144, bottom: 176, left: 130 };

    const zoom = 1.25;
    const pos = computeBubbleMenuPosition(firstRect, lastRect, wrapRect, zoom);
    // relTop = 64 / 1.25 = 51.2 >= BUBBLE_MENU_CLEARANCE (44) -> below = false
    expect(pos.below).toBe(false);
    expect(pos.top).toBeCloseTo(51.2 - BUBBLE_MENU_GAP, 2);
    expect(pos.left).toBeCloseTo(30 / 1.25, 2);
  });
});

describe("Editor component bubble hover menu layout", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders bubble-hover-menu and bubble-model-menu classes when hovering an idea bubble", async () => {
    useStore.setState({
      active: {
        id: "note-idea-1",
        title: "Test Note",
        body: "# Header Title\nFirst bubble description line 1\nFirst bubble description line 2\n\nSecond bubble content",
        type: "idea",
        tags: ["feature"],
        models: {},
        bubbleTags: {},
        created: "2026-08-01T00:00:00Z",
        updated: "2026-08-01T00:00:00Z",
        path: "Test Note.md",
        summary: null,
        icon: null,
        collection: null,
        position: null,
        model: null,
        project: null,
        mark: "off",
        bubbleIssues: {},
        issueStates: {},
        remote: null,
      },
    });

    await act(async () => {
      root.render(<Editor />);
    });

    // Find the first line element in the editor
    const firstPara = container.querySelector(".cm-para.first");
    expect(firstPara).not.toBeNull();

    // Trigger mouse move over the first bubble line
    const editorWrap = container.querySelector(".editor-wrap");
    expect(editorWrap).not.toBeNull();

    await act(async () => {
      firstPara?.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          clientX: 50,
          clientY: 80,
        }),
      );
    });

    // Check if hover menu is displayed with both classes
    const hoverMenu = container.querySelector(".bubble-hover-menu");
    expect(hoverMenu).not.toBeNull();
    expect(hoverMenu?.classList.contains("bubble-model-menu")).toBe(true);
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

describe("resilient bubble model and tag resolution", () => {
  it("normalizes bubble keys by stripping markdown header tokens and list markers", () => {
    expect(normalizeBubbleKey("# My Feature")).toBe("My Feature");
    expect(normalizeBubbleKey("### Deep Header")).toBe("Deep Header");
    expect(normalizeBubbleKey("- A list item")).toBe("A list item");
    expect(normalizeBubbleKey("1. Numbered item")).toBe("Numbered item");
    expect(normalizeBubbleKey("Plain title")).toBe("Plain title");
  });

  it("resolves model by exact match and normalized match", () => {
    const models = {
      "Refactor Editor": "anthropic/claude-3-5-sonnet",
      "# Implement Search": "openai/gpt-4o",
    };

    // Exact match
    expect(resolveBubbleModel(models, "Refactor Editor")).toBe("anthropic/claude-3-5-sonnet");

    // Normalized match with markdown formatting added
    expect(resolveBubbleModel(models, "## Refactor Editor")).toBe("anthropic/claude-3-5-sonnet");
    expect(resolveBubbleModel(models, "Implement Search")).toBe("openai/gpt-4o");

    // Non-existent
    expect(resolveBubbleModel(models, "Unassigned Idea")).toBeNull();
  });

  it("resolves model during prefix/in-progress typing edits", () => {
    const models = {
      "Persistent Model Tracking": "anthropic/claude-3-5-sonnet",
    };

    // Typing at the end of the line
    expect(resolveBubbleModel(models, "Persistent Model Tracking in Editor")).toBe("anthropic/claude-3-5-sonnet");

    // Truncated during partial edit
    expect(resolveBubbleModel(models, "Persistent Model")).toBe("anthropic/claude-3-5-sonnet");
  });

  it("resolves bubble tags resiliently across formatting changes", () => {
    const bubbleTags = {
      "Core UI": ["frontend", "v1"],
    };

    expect(resolveBubbleTags(bubbleTags, "Core UI")).toEqual(["frontend", "v1"]);
    expect(resolveBubbleTags(bubbleTags, "# Core UI")).toEqual(["frontend", "v1"]);
    expect(resolveBubbleTags(bubbleTags, "Core UI components")).toEqual(["frontend", "v1"]);
    expect(resolveBubbleTags(bubbleTags, "Unrelated")).toEqual([]);
  });
});

describe("bubble model persistence during typing", () => {
  function makeIdeaEditor(initialDoc: string): EditorView {
    return new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          markdown(),
          bubbleMetadataDecorations,
          bubbleModelPersistence,
        ],
      }),
    });
  }

  it("preserves assigned model when typing in and modifying the first line of a bubble", () => {
    const initialDoc = "First bubble idea\nSome details here\n\nSecond bubble idea\nMore details";
    const initialModel = "anthropic/claude-3-5-sonnet-20241022";

    useStore.setState({
      active: {
        id: "note-1",
        type: "idea",
        models: { "First bubble idea": initialModel },
        bubbleTags: { "First bubble idea": ["urgent"] },
        tags: [],
      } as never,
      aiSettings: {
        enabled: true,
        showBubbleMetadata: true,
        configured: true,
      },
    });

    const view = makeIdeaEditor(initialDoc);

    // Initial decorations verify model widget is active
    let decos = buildHeatDecorations(view.state);
    let iter = decos.iter();
    let hasModelWidget = false;
    while (iter.value) {
      if ((iter.value.spec as { widget?: { model?: string } })?.widget?.model === initialModel) {
        hasModelWidget = true;
      }
      iter.next();
    }
    expect(hasModelWidget).toBe(true);

    // Type in the first line: insert " - refined" into "First bubble idea"
    const insertPos = "First bubble idea".length;
    view.dispatch({
      changes: { from: insertPos, insert: " - refined" },
    });

    // Verify document updated
    expect(view.state.doc.sliceString(0, "First bubble idea - refined".length)).toBe(
      "First bubble idea - refined",
    );

    // 1. The store models mapping must have automatically migrated to the new first line key
    const active = useStore.getState().active;
    expect(active?.models?.["First bubble idea - refined"]).toBe(initialModel);
    expect(active?.models?.["First bubble idea"]).toBeUndefined();

    // 2. The store bubbleTags mapping must have automatically migrated as well
    expect(active?.bubbleTags?.["First bubble idea - refined"]).toEqual(["urgent"]);
    expect(active?.bubbleTags?.["First bubble idea"]).toBeUndefined();

    // 3. The decoration builder must preserve and display the assigned model badge
    decos = buildHeatDecorations(view.state);
    iter = decos.iter();
    hasModelWidget = false;
    while (iter.value) {
      if ((iter.value.spec as { widget?: { model?: string } })?.widget?.model === initialModel) {
        hasModelWidget = true;
      }
      iter.next();
    }
    expect(hasModelWidget).toBe(true);
  });

  it("persists model assignment when backspacing/deleting text in the first line", () => {
    const initialDoc = "A very long detailed bubble title\nContent body";
    const model = "openai/gpt-4o";

    useStore.setState({
      active: {
        id: "note-4",
        type: "idea",
        models: {
          "A very long detailed bubble title": model,
        },
        bubbleTags: {},
        tags: [],
      } as never,
      aiSettings: {
        enabled: true,
        showBubbleMetadata: true,
        configured: true,
      },
    });

    const view = makeIdeaEditor(initialDoc);

    // Delete " detailed bubble" -> "A very long title"
    const from = "A very long".length;
    const to = "A very long detailed bubble".length;
    view.dispatch({
      changes: { from, to, insert: "" },
    });

    const active = useStore.getState().active;
    expect(active?.models?.["A very long title"]).toBe(model);
    expect(active?.models?.["A very long detailed bubble title"]).toBeUndefined();
  });

  it("handles changing header levels without dropping model badge", () => {
    const initialDoc = "# Idea Heading\nContent";
    const model = "anthropic/claude-3-5-haiku";

    useStore.setState({
      active: {
        id: "note-5",
        type: "idea",
        models: {
          "# Idea Heading": model,
        },
        bubbleTags: {},
        tags: [],
      } as never,
      aiSettings: {
        enabled: true,
        showBubbleMetadata: true,
        configured: true,
      },
    });

    const view = makeIdeaEditor(initialDoc);

    // Change # to ###
    view.dispatch({
      changes: { from: 0, to: 1, insert: "###" },
    });

    const active = useStore.getState().active;
    expect(active?.models?.["### Idea Heading"]).toBe(model);
  });

  it("maintains separate model assignments across multiple bubbles when one is edited", () => {
    const initialDoc = "Alpha Bubble\nLine 1\n\nBeta Bubble\nLine 2";
    const modelAlpha = "anthropic/claude-3-5-sonnet";
    const modelBeta = "openai/gpt-4o";

    useStore.setState({
      active: {
        id: "note-2",
        type: "idea",
        models: {
          "Alpha Bubble": modelAlpha,
          "Beta Bubble": modelBeta,
        },
        bubbleTags: {},
        tags: [],
      } as never,
      aiSettings: {
        enabled: true,
        showBubbleMetadata: true,
        configured: true,
      },
    });

    const view = makeIdeaEditor(initialDoc);

    // Edit Alpha Bubble to "Alpha Bubble v2"
    view.dispatch({
      changes: { from: "Alpha Bubble".length, insert: " v2" },
    });

    const active = useStore.getState().active;
    // Alpha migrated to "Alpha Bubble v2"
    expect(active?.models?.["Alpha Bubble v2"]).toBe(modelAlpha);
    expect(active?.models?.["Alpha Bubble"]).toBeUndefined();

    // Beta remains unchanged
    expect(active?.models?.["Beta Bubble"]).toBe(modelBeta);
  });

  it("persists model assignment when editing first text line in marked bubbles", () => {
    const initialDoc = "<!-- bubble -->\n# Marked idea title\nBody content\n<!-- /bubble -->";
    const modelMarked = "meta-llama/llama-3.3-70b-instruct";

    useStore.setState({
      active: {
        id: "note-3",
        type: "idea",
        models: {
          "# Marked idea title": modelMarked,
        },
        bubbleTags: {},
        tags: [],
      } as never,
      aiSettings: {
        enabled: true,
        showBubbleMetadata: true,
        configured: true,
      },
    });

    const view = makeIdeaEditor(initialDoc);

    // Edit the heading title inside the marked bubble
    const pos = initialDoc.indexOf("Marked idea title") + "Marked idea title".length;
    view.dispatch({
      changes: { from: pos, insert: " updated" },
    });

    const active = useStore.getState().active;
    expect(active?.models?.["# Marked idea title updated"]).toBe(modelMarked);
  });
});

describe("deleting a bubble does not hand its metadata to a neighbour", () => {
  function makeIdeaEditor(initialDoc: string): EditorView {
    return new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: initialDoc,
        extensions: [markdown(), bubbleMetadataDecorations, bubbleModelPersistence],
      }),
    });
  }

  /** Deleting a bubble collapses its range onto the deletion point, which lands
   *  inside whatever moves up to fill the gap. That used to read as a rename,
   *  so a deleted bubble's issue link and model were inherited by the bubble
   *  below it — which then muted itself against an issue it never had. */
  it("drops the metadata instead of migrating it to the bubble below", () => {
    const first = "Deleted bubble";
    const second = "Surviving bubble";
    const initialDoc = `${first}\ndetails\n\n${second}\nmore details`;

    useStore.setState({
      active: {
        id: "note-1",
        type: "idea",
        models: { [first]: "anthropic/claude-opus-5" },
        bubbleTags: { [first]: ["urgent"] },
        bubbleIssues: { [first]: "o/r#9" },
        issueStates: {},
        tags: [],
      } as never,
      aiSettings: { enabled: true, showBubbleMetadata: true, configured: true },
    });

    const view = makeIdeaEditor(initialDoc);

    // Remove the first bubble and its trailing blank line, exactly as the
    // bubble menu and the sidebar's "Delete bubble" both do.
    view.dispatch({
      changes: { from: 0, to: initialDoc.indexOf(second), insert: "" },
    });

    expect(view.state.doc.toString()).toBe(`${second}\nmore details`);

    const active = useStore.getState().active;
    expect(active?.models?.[second]).toBeUndefined();
    expect(active?.bubbleTags?.[second]).toBeUndefined();
    expect(active?.bubbleIssues?.[second]).toBeUndefined();
  });

  it("still migrates when the first line is edited rather than deleted", () => {
    const initialDoc = "Kept bubble\ndetails\n\nOther bubble\nmore";

    useStore.setState({
      active: {
        id: "note-1",
        type: "idea",
        models: {},
        bubbleTags: {},
        bubbleIssues: { "Kept bubble": "o/r#9" },
        issueStates: {},
        tags: [],
      } as never,
      aiSettings: { enabled: true, showBubbleMetadata: true, configured: true },
    });

    const view = makeIdeaEditor(initialDoc);
    view.dispatch({ changes: { from: "Kept bubble".length, insert: " renamed" } });

    const active = useStore.getState().active;
    expect(active?.bubbleIssues?.["Kept bubble renamed"]).toBe("o/r#9");
    expect(active?.bubbleIssues?.["Other bubble"]).toBeUndefined();
  });
});

describe("visual divider lines (___ and ---)", () => {
  it("detects when a selection overlaps a line range", () => {
    const state = EditorState.create({
      doc: "Line 1\nLine 2\nLine 3",
      selection: { anchor: 8, head: 8 },
    });
    expect(isLineSelected(state, 7, 13)).toBe(true);
    expect(isLineSelected(state, 0, 6)).toBe(false);
    expect(isLineSelected(state, 14, 20)).toBe(false);
  });

  it("classifies divider types correctly", () => {
    expect(getDividerType("___")).toBe("bold");
    expect(getDividerType("____")).toBe("bold");
    expect(getDividerType("_ _ _")).toBe("bold");
    expect(getDividerType("   ___   ")).toBe("bold");

    expect(getDividerType("---")).toBe("subtle");
    expect(getDividerType("----")).toBe("subtle");
    expect(getDividerType("- - -")).toBe("subtle");
    expect(getDividerType("   ---   ")).toBe("subtle");
    expect(getDividerType("***")).toBe("subtle");

    expect(getDividerType("__")).toBeNull();
    expect(getDividerType("--")).toBeNull();
    expect(getDividerType("regular text")).toBeNull();
    expect(getDividerType("## Heading")).toBeNull();
    expect(getDividerType("--- title: idea")).toBeNull();
  });

  it("detects frontmatter end line and ignores non-frontmatter documents", () => {
    const fmDoc = EditorState.create({
      doc: "---\nid: 123\ntitle: Test\n---\nFirst paragraph\n---\nSecond paragraph",
    }).doc;
    expect(getFrontmatterEndLine(fmDoc)).toBe(4);

    const plainDoc = EditorState.create({
      doc: "First paragraph\n---\nSecond paragraph",
    }).doc;
    expect(getFrontmatterEndLine(plainDoc)).toBe(0);

    const unterminatedDoc = EditorState.create({
      doc: "---\nid: 123\ntitle: Test\nFirst paragraph",
    }).doc;
    expect(getFrontmatterEndLine(unterminatedDoc)).toBe(0);
  });

  it("builds bold widget decoration for ___ and subtle widget decoration for --- when cursor is away", () => {
    const doc = "Paragraph 1\n\n___\n\nParagraph 2\n\n---\n\nParagraph 3";
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        extensions: [markdown(), visualDividers],
        selection: { anchor: 0 },
      }),
    });

    const decos = buildDividerDecorations(view);
    let boldLineFound = false;
    let boldWidgetFound = false;
    let subtleLineFound = false;
    let subtleWidgetFound = false;

    decos.between(0, doc.length, (_from, _to, value) => {
      const spec = (value as unknown as { spec: Record<string, unknown> }).spec;
      if (spec.class === "cm-divider-line cm-divider-line-bold") {
        boldLineFound = true;
      }
      if (spec.class === "cm-divider-line cm-divider-line-subtle") {
        subtleLineFound = true;
      }
      if (spec.widget && (spec.widget as { kind?: string }).kind === "bold") {
        boldWidgetFound = true;
      }
      if (spec.widget && (spec.widget as { kind?: string }).kind === "subtle") {
        subtleWidgetFound = true;
      }
    });

    expect(boldLineFound).toBe(true);
    expect(boldWidgetFound).toBe(true);
    expect(subtleLineFound).toBe(true);
    expect(subtleWidgetFound).toBe(true);
  });

  it("reveals raw text and does not replace with widget when cursor is on the divider line", () => {
    const doc = "Paragraph 1\n\n___\n\nParagraph 2";
    const dividerPos = doc.indexOf("___");
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        extensions: [markdown(), visualDividers],
        selection: { anchor: dividerPos + 1 }, // caret inside '___'
      }),
    });

    const decos = buildDividerDecorations(view);
    let activeLineFound = false;
    let rawMarkFound = false;
    let widgetFound = false;

    decos.between(0, doc.length, (_from, _to, value) => {
      const spec = (value as unknown as { spec: Record<string, unknown> }).spec;
      if (spec.class === "cm-divider-line cm-divider-line-bold cm-divider-active") {
        activeLineFound = true;
      }
      if (spec.class === "cm-divider-raw cm-divider-raw-bold") {
        rawMarkFound = true;
      }
      if (spec.widget) {
        widgetFound = true;
      }
    });

    expect(activeLineFound).toBe(true);
    expect(rawMarkFound).toBe(true);
    expect(widgetFound).toBe(false); // Widget replacement must not be present while active
  });

  it("does not decorate frontmatter delimiters as visual dividers", () => {
    const doc = "---\nid: test\ntitle: Note\n---\n\nBody paragraph\n\n---\n\nSecond paragraph";
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        extensions: [markdown(), visualDividers],
        selection: { anchor: 0 },
      }),
    });

    const decos = buildDividerDecorations(view);
    const decoratedOffsets: number[] = [];

    decos.between(0, doc.length, (from) => {
      decoratedOffsets.push(from);
    });

    // Line 1 (pos 0) and Line 4 (closing frontmatter) must NOT be decorated.
    // Only the standalone --- inside the body (after line 4) should be decorated.
    const bodyDividerPos = doc.lastIndexOf("---");
    expect(decoratedOffsets).not.toContain(0);
    expect(decoratedOffsets).toContain(bodyDividerPos);
  });

  it("ensures divider lines do not break bubble counting and outline navigation", () => {
    const doc = "Bubble 1\n\n___\n\nBubble 2\n\n---\n\nBubble 3";
    const state = EditorState.create({ doc, extensions: [markdown()] });
    const bubbles = computeBubbles(state);

    expect(bubbles).toHaveLength(3);
    expect(state.doc.sliceString(bubbles[0].from, bubbles[0].to)).toBe("Bubble 1");
    expect(state.doc.sliceString(bubbles[1].from, bubbles[1].to)).toBe("Bubble 2");
    expect(state.doc.sliceString(bubbles[2].from, bubbles[2].to)).toBe("Bubble 3");

    // Caret on divider line returns null for bubble selection, allowing immediate fall-through to select-all
    const dividerPos = doc.indexOf("___");
    expect(bubbleForModA(dividerPos, dividerPos, dividerPos, bubbles)).toBeNull();
  });
});

describe("typing a divider finishes it immediately", () => {
  function makeDividerEditor(doc: string, anchor: number): EditorView {
    return new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        selection: { anchor },
        extensions: [markdown(), visualDividers, dividerAutoBreak],
      }),
    });
  }

  /** The divider only renders while the caret is elsewhere, so completing one
   *  has to move the caret off it — otherwise the raw characters sit on screen
   *  until the user happens to click away. */
  it("moves the caret to a fresh line once the divider is complete", async () => {
    const doc = "Above\n\n--";
    const view = makeDividerEditor(doc, doc.length);

    view.dispatch({
      changes: { from: doc.length, insert: "-" },
      selection: { anchor: doc.length + 1 },
      userEvent: "input.type",
    });
    await Promise.resolve();

    expect(view.state.doc.toString()).toBe("Above\n\n---\n");
    const caret = view.state.selection.main.head;
    expect(view.state.doc.lineAt(caret).number).toBe(4);
    expect(view.state.doc.lineAt(caret).text).toBe("");
    view.destroy();
  });

  it("leaves an existing divider alone when it is extended", async () => {
    const doc = "Above\n\n---";
    const view = makeDividerEditor(doc, doc.length);

    view.dispatch({
      changes: { from: doc.length, insert: "-" },
      selection: { anchor: doc.length + 1 },
      userEvent: "input.type",
    });
    await Promise.resolve();

    expect(view.state.doc.toString()).toBe("Above\n\n----");
    view.destroy();
  });

  it("does not fire on a paste", async () => {
    const doc = "Above\n\n";
    const view = makeDividerEditor(doc, doc.length);

    view.dispatch({
      changes: { from: doc.length, insert: "---" },
      selection: { anchor: doc.length + 3 },
      userEvent: "input.paste",
    });
    await Promise.resolve();

    expect(view.state.doc.toString()).toBe("Above\n\n---");
    view.destroy();
  });
});
