import { describe, expect, it } from "vitest";
import { history } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";

import { EditorStateCache } from "./editorStateCache";
import { documentBelongsTo, noteIdField, noteIdOf, setNoteId } from "./noteIdField";

const extensions = [history({ minDepth: 150, newGroupDelay: 500 }), noteIdField];

/** A document bound to a note, the way the editor builds one. */
function bound(noteId: string, doc: string) {
  return EditorState.create({ doc, extensions })
    .update({ effects: setNoteId.of(noteId) })
    .state;
}

describe("a document knows which note it belongs to", () => {
  it("is unbound until an id is set", () => {
    expect(noteIdOf(EditorState.create({ doc: "", extensions }))).toBeNull();
  });

  it("reports the id it was bound to", () => {
    expect(noteIdOf(bound("note-1", "text"))).toBe("note-1");
  });

  it("keeps the id across edits", () => {
    // The whole point: the id cannot be left behind by a change to the text,
    // so any snapshot of the document carries its own identity.
    let state = bound("note-1", "text");
    for (const word of ["one", "two", "three"]) {
      state = state.update({
        changes: { from: state.doc.length, insert: ` ${word}` },
      }).state;
      expect(noteIdOf(state)).toBe("note-1");
    }
    expect(state.doc.toString()).toBe("text one two three");
  });

  it("changes only when the document is rebound", () => {
    const rebound = bound("note-1", "text").update({
      effects: setNoteId.of("note-2"),
    }).state;
    expect(noteIdOf(rebound)).toBe("note-2");
  });

  it("answers whether it may be saved under a given note", () => {
    const state = bound("note-1", "text");
    expect(documentBelongsTo(state, "note-1")).toBe(true);
    expect(documentBelongsTo(state, "note-2")).toBe(false);
    expect(documentBelongsTo(EditorState.create({ doc: "", extensions }), "note-1")).toBe(
      false,
    );
  });
});

describe("the editor state cache will not hold a mislabelled entry", () => {
  it("refuses to file a document under a different note", () => {
    const cache = new EditorStateCache(10);
    expect(() =>
      cache.set("note-b", {
        noteId: "note-a",
        state: bound("note-a", "a's text"),
        scrollTop: 0,
      }),
    ).toThrow(/note-a/);
    expect(cache.has("note-b")).toBe(false);
  });

  it("discards an entry that disagrees with its own key", () => {
    const cache = new EditorStateCache(10);
    cache.set("note-a", {
      noteId: "note-a",
      state: bound("note-a", "a's text"),
      scrollTop: 0,
    });

    // Simulate an entry left behind by an earlier build, where nothing recorded
    // which note a cached document came from.
    const entry = cache.get("note-a")!;
    (entry as { noteId: string }).noteId = "note-b";
    (cache as unknown as { cache: Map<string, unknown> }).cache.set("note-a", entry);

    expect(cache.get("note-a")).toBeUndefined();
    expect(cache.has("note-a")).toBe(false);
  });

  it("returns an entry that agrees with its key", () => {
    const cache = new EditorStateCache(10);
    cache.set("note-a", {
      noteId: "note-a",
      state: bound("note-a", "a's text"),
      scrollTop: 12,
    });

    const entry = cache.get("note-a");
    expect(entry?.scrollTop).toBe(12);
    expect(noteIdOf(entry!.state)).toBe("note-a");
  });
});
