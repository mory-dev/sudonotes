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
  buildDividerDecorations,
  buildHeatDecorations,
  computeBubbles,
  getDividerType,
  getFrontmatterEndLine,
  inferBubbleTags,
  isLineSelected,
  modABinding,
  normalizeBubbleKey,
  resolveBubbleModel,
  resolveBubbleTags,
  visualDividers,
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
