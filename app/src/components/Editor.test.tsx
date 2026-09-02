import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import { useStore } from "../store";
import {
  BUBBLE_MENU_CLEARANCE,
  BUBBLE_MENU_GAP,
  bubbleFirstLine,
  bubbleForModA,
  bubbleLastLine,
  bubbleTagsForLabel,
  computeBubbleMenuPosition,
  computeBubbles,
  Editor,
  inferBubbleTags,
  modABinding,
} from "./Editor";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A minimal idea-note editor with the real Ctrl+A binding and CodeMirror's
 *  default keymap (which supplies select-all for the fall-through). */
function makeView(doc: string): EditorView {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [
        markdown(),
        keymap.of([modABinding]),
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
        onHold: false,
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
