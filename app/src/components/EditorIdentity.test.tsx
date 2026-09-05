/**
 * Regression cover for the cross-note overwrite.
 *
 * A document used to be paired with a note id held beside it, in a ref that the
 * text knew nothing about. While a note switch was half-applied the pair could
 * disagree, and the autosave then wrote one note's body into another note's
 * file — the reported symptom was a note that permanently mirrored an unrelated
 * one, with its own contents lost. These tests drive the real editor and assert
 * the invariant that makes that impossible: every write carries the body that
 * was on screen for the note it is filed under.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";

const writes: Array<{ id: string; body: string; base?: string }> = [];

/** Bodies keyed by note id, each carrying a marker unique to that note so a
 *  body that reaches the wrong file is unmistakable. */
const bodies = new Map<string, string>([
  ["note-a", "MARK-note-a first line\n"],
  ["note-b", "MARK-note-b first line\n"],
  ["note-c", "MARK-note-c first line\n"],
]);

const ALL_MARKERS = ["MARK-note-a", "MARK-note-b", "MARK-note-c"];

vi.mock("../api", () => {
  const detail = (id: string) => ({
    id,
    title: id,
    type: "idea" as const,
    tags: [],
    summary: null,
    model: null,
    collection: null,
    position: null,
    project: null,
    mark: "off",
    models: {},
    bubbleTags: {},
    bubbleIssues: {},
    issueStates: {},
    remote: null,
    created: "2026-09-01T00:00:00Z",
    updated: "2026-09-01T00:00:00Z",
    body: bodies.get(id) ?? "",
    baseHash: `hash:${bodies.get(id) ?? ""}`,
    path: `/vault/ideas/${id}.md`,
  });

  return {
    api: {
      readNote: vi.fn(async (id: string) => detail(id)),
      backlinks: vi.fn(async () => []),
      collectionChildren: vi.fn(async () => []),
      listNotes: vi.fn(async () => []),
      writeNote: vi.fn(async (id: string, body: string, base?: string) => {
        writes.push({ id, body, base });
        bodies.set(id, body);
        return `hash:${body}`;
      }),
      renameBubbleKey: vi.fn(async () => undefined),
      renameNote: vi.fn(async () => undefined),
      autoTagNote: vi.fn(async () => []),
      aiHealth: vi.fn(async () => false),
    },
  };
});

const { editorStateCache } = await import("../editorStateCache");
const { noteIdOf } = await import("../noteIdField");
const { useStore } = await import("../store");
const { Editor } = await import("./Editor");

/** The live CodeMirror view inside the mounted editor. */
function currentView(container: HTMLElement): EditorView {
  const content = container.querySelector(".cm-content");
  expect(content).not.toBeNull();
  const view = EditorView.findFromDOM(content as HTMLElement);
  expect(view).not.toBeNull();
  return view as EditorView;
}

/** Type at the end of the document, the way the change listener sees typing. */
function typeAtEnd(view: EditorView, text: string) {
  view.dispatch({
    changes: { from: view.state.doc.length, insert: text },
  });
}

/** Assert no write ever carried another note's text. */
function assertNoCrossContamination() {
  for (const write of writes) {
    const own = `MARK-${write.id}`;
    expect(
      write.body.includes(own),
      `write for ${write.id} lost its own marker: ${JSON.stringify(write.body)}`,
    ).toBe(true);
    for (const marker of ALL_MARKERS) {
      if (marker === own) continue;
      expect(
        write.body.includes(marker),
        `write for ${write.id} carried ${marker}: ${JSON.stringify(write.body)}`,
      ).toBe(false);
    }
  }
}

describe("a document can only be saved under the note it belongs to", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    writes.length = 0;
    bodies.set("note-a", "MARK-note-a first line\n");
    bodies.set("note-b", "MARK-note-b first line\n");
    bodies.set("note-c", "MARK-note-c first line\n");
    editorStateCache.clear();

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useStore.setState({ vaultPath: "/vault", active: null, notes: [] });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("binds the open note's id into the document", async () => {
    await act(async () => {
      root.render(<Editor />);
    });
    await act(async () => {
      await useStore.getState().select("note-a");
    });

    expect(noteIdOf(currentView(container).state)).toBe("note-a");
  });

  it("carries the id with the document across a switch", async () => {
    await act(async () => {
      root.render(<Editor />);
    });
    await act(async () => {
      await useStore.getState().select("note-a");
    });
    await act(async () => {
      await useStore.getState().select("note-b");
    });

    const view = currentView(container);
    expect(noteIdOf(view.state)).toBe("note-b");
    expect(view.state.doc.toString()).toContain("MARK-note-b");
  });

  it("files typing under the note whose text is on screen", async () => {
    await act(async () => {
      root.render(<Editor />);
    });
    await act(async () => {
      await useStore.getState().select("note-a");
    });

    await act(async () => {
      typeAtEnd(currentView(container), "typed into a\n");
    });
    await act(async () => {
      await useStore.getState().flushSave();
    });

    expect(writes).toHaveLength(1);
    expect(writes[0].id).toBe("note-a");
    expect(writes[0].body).toContain("typed into a");
    assertNoCrossContamination();
  });

  it("never writes one note's body into another across rapid switching", async () => {
    await act(async () => {
      root.render(<Editor />);
    });

    // A deterministic interleaving of selects and typing. Each step types into
    // whatever the editor currently shows, which is exactly the situation the
    // bug arose in: the store, the ref and the document each moving at their
    // own pace.
    const order = [
      "note-a",
      "note-b",
      "note-a",
      "note-c",
      "note-b",
      "note-c",
      "note-a",
      "note-b",
    ];

    for (const [step, id] of order.entries()) {
      await act(async () => {
        await useStore.getState().select(id);
      });
      await act(async () => {
        typeAtEnd(currentView(container), `edit ${step}\n`);
      });
      // Flush on some iterations only, so a pending save is sometimes still
      // outstanding when the next note is selected.
      if (step % 2 === 1) {
        await act(async () => {
          await useStore.getState().flushSave();
        });
      }
    }

    await act(async () => {
      await useStore.getState().flushSave();
    });

    expect(writes.length).toBeGreaterThan(0);
    assertNoCrossContamination();
  });

  it("keeps a pending edit for each note when several are dirty", async () => {
    await act(async () => {
      root.render(<Editor />);
    });

    // Type into one note and switch away without flushing, twice over. A single
    // pending slot dropped the earlier note's edit; both must survive.
    await act(async () => {
      await useStore.getState().select("note-a");
    });
    await act(async () => {
      typeAtEnd(currentView(container), "only in a\n");
    });
    await act(async () => {
      useStore.getState().queueSave("note-b", `${bodies.get("note-b")}only in b\n`);
    });

    await act(async () => {
      await useStore.getState().flushSave();
    });

    const ids = writes.map((w) => w.id).sort();
    expect(ids).toEqual(["note-a", "note-b"]);
    assertNoCrossContamination();
  });

  it("sends the body it is replacing as the write's precondition", async () => {
    await act(async () => {
      root.render(<Editor />);
    });
    await act(async () => {
      await useStore.getState().select("note-a");
    });
    await act(async () => {
      typeAtEnd(currentView(container), "more text\n");
    });
    await act(async () => {
      await useStore.getState().flushSave();
    });

    expect(writes[0].base).toBe("hash:MARK-note-a first line\n");
  });

  it("refuses to keep a cached document that belongs to another note", async () => {
    await act(async () => {
      root.render(<Editor />);
    });
    await act(async () => {
      await useStore.getState().select("note-a");
    });

    const foreign = currentView(container).state;
    expect(noteIdOf(foreign)).toBe("note-a");

    // Plant note-a's document in note-b's slot, the corrupt state the bug left
    // behind, and confirm opening note-b does not adopt it.
    editorStateCache.delete("note-b");
    expect(() =>
      editorStateCache.set("note-b", {
        noteId: "note-a",
        state: foreign,
        scrollTop: 0,
      }),
    ).toThrow();

    await act(async () => {
      await useStore.getState().select("note-b");
    });

    const view = currentView(container);
    expect(noteIdOf(view.state)).toBe("note-b");
    expect(view.state.doc.toString()).not.toContain("MARK-note-a");

    await act(async () => {
      typeAtEnd(view, "typed into b\n");
    });
    await act(async () => {
      await useStore.getState().flushSave();
    });
    assertNoCrossContamination();
  });

  it("discards a cache entry in the right slot holding the wrong text", async () => {
    await act(async () => {
      root.render(<Editor />);
    });
    await act(async () => {
      await useStore.getState().select("note-a");
    });

    // The exact corrupt state the bug produced: an entry filed under note-b
    // whose document is note-a's text and undo history. The label matches the
    // slot, so nothing about the key gives it away — only the document does.
    const foreignDoc = currentView(container).state;
    editorStateCache.set("note-b", {
      noteId: "note-b",
      state: foreignDoc,
      scrollTop: 0,
    });

    await act(async () => {
      await useStore.getState().select("note-b");
    });

    const view = currentView(container);
    expect(noteIdOf(view.state)).toBe("note-b");
    expect(view.state.doc.toString()).toBe("MARK-note-b first line\n");
    expect(view.state.doc.toString()).not.toContain("MARK-note-a");

    await act(async () => {
      typeAtEnd(view, "b keeps its own text\n");
    });
    await act(async () => {
      await useStore.getState().flushSave();
    });

    expect(writes.every((w) => w.id === "note-b")).toBe(true);
    assertNoCrossContamination();
  });

  it("cannot undo a foreign document back into a note", async () => {
    // This is the loop the user hit: emptying the mirrored note did not stick.
    // The poisoned undo stack was carried over when the document was rebased,
    // so an undo restored the other note's text and the autosave wrote it back.
    await act(async () => {
      root.render(<Editor />);
    });
    await act(async () => {
      await useStore.getState().select("note-a");
    });

    const foreignDoc = currentView(container).state;
    editorStateCache.set("note-b", {
      noteId: "note-b",
      state: foreignDoc,
      scrollTop: 0,
    });

    await act(async () => {
      await useStore.getState().select("note-b");
    });

    const view = currentView(container);
    // Give the history something of note-b's own to undo, then undo as far as
    // it will go. Nothing note-a ever held may reappear.
    await act(async () => {
      typeAtEnd(view, "b edit\n");
    });
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        undo(view);
      });
    }

    expect(view.state.doc.toString()).not.toContain("MARK-note-a");

    await act(async () => {
      await useStore.getState().flushSave();
    });
    assertNoCrossContamination();
  });

  it("does not save an unbound document", async () => {
    await act(async () => {
      root.render(<Editor />);
    });

    // No note open: the placeholder document belongs to nothing and there is
    // nothing to file it under.
    await act(async () => {
      typeAtEnd(currentView(container), "stray text");
    });
    await act(async () => {
      await useStore.getState().flushSave();
    });

    expect(writes).toHaveLength(0);
  });
});
