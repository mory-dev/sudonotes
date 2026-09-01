import { afterEach, describe, expect, it } from "vitest";
import { closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import { useStore } from "../store";
import {
  bubbleForModA,
  bubbleMetadataDecorations,
  bubbleModelPersistence,
  bubbleTagsForLabel,
  buildHeatDecorations,
  computeBubbles,
  inferBubbleTags,
  modABinding,
  normalizeBubbleKey,
  resolveBubbleModel,
  resolveBubbleTags,
} from "./Editor";

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
  useStore.setState({ active: null });
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
