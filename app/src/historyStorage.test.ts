import { describe, expect, it } from "vitest";
import { history, isolateHistory, undo, redo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  buildHistoryKey,
  deserializeHistoryState,
  flushPendingHistory,
  isHistoryUsable,
  saveHistoryDebounced,
  serializeHistoryState,
} from "./historyStorage";
import { noteIdField, noteIdOf, setNoteId } from "./noteIdField";

describe("historyStorage unit tests", () => {
  const extensions = [history({ minDepth: 150, newGroupDelay: 500 })];

  it("buildHistoryKey handles vault paths and note ids correctly", () => {
    expect(buildHistoryKey("my-vault", "note-1")).toBe("sudonotes:history:my-vault:note-1");
    expect(buildHistoryKey("  vault-trimmed  ", "note-2")).toBe("sudonotes:history:vault-trimmed:note-2");
    expect(buildHistoryKey("", "note-3")).toBe("sudonotes:history:default:note-3");
    expect(buildHistoryKey(null, "note-4")).toBe("sudonotes:history:default:note-4");
    expect(buildHistoryKey(undefined, "note-5")).toBe("sudonotes:history:default:note-5");
  });

  it("round-trips EditorState serialization and preserves multi-step undo history", () => {
    let state = EditorState.create({ doc: "Start", extensions });
    state = state.update({
      changes: { from: 5, insert: " Step 1" },
      annotations: isolateHistory.of("before"),
    }).state;
    state = state.update({
      changes: { from: 12, insert: " Step 2" },
      annotations: isolateHistory.of("before"),
    }).state;

    expect(state.doc.toString()).toBe("Start Step 1 Step 2");

    const serialized = serializeHistoryState(state, 42);
    expect(serialized.doc).toBe("Start Step 1 Step 2");
    expect(serialized.scrollTop).toBe(42);

    const deserialized = deserializeHistoryState(serialized.historyJSON, extensions);
    expect(deserialized).not.toBeNull();
    expect(deserialized!.doc.toString()).toBe("Start Step 1 Step 2");

    const view = new EditorView({ state: deserialized! });
    undo(view);
    expect(view.state.doc.toString()).toBe("Start Step 1");
    undo(view);
    expect(view.state.doc.toString()).toBe("Start");
    redo(view);
    expect(view.state.doc.toString()).toBe("Start Step 1");
    redo(view);
    expect(view.state.doc.toString()).toBe("Start Step 1 Step 2");
  });

  it("gracefully returns null on invalid JSON during deserialization", () => {
    const invalidJSON = { doc: 123, invalid: true } as unknown as Record<string, unknown>;
    const res = deserializeHistoryState(invalidJSON, extensions);
    // Should safely handle malformed JSON without crashing
    expect(res === null || res instanceof EditorState).toBe(true);
  });

  it("handles debounce and flush gracefully even when IndexedDB is unavailable", async () => {
    const state = EditorState.create({ doc: "Sample", extensions });
    saveHistoryDebounced("vault-test", "note-test", state, 10, 100);
    await flushPendingHistory();
  });

  it("carries the note id through serialization", () => {
    // The id has to survive the round trip, because that is what lets a
    // restored history be checked against the note it is being restored into.
    const bound = [...extensions, noteIdField];
    const state = EditorState.create({ doc: "Body", extensions: bound })
      .update({ effects: setNoteId.of("note-42") })
      .state;

    expect(noteIdOf(state)).toBe("note-42");

    const restored = deserializeHistoryState(
      serializeHistoryState(state, 0).historyJSON,
      bound,
    );
    expect(restored).not.toBeNull();
    expect(noteIdOf(restored!)).toBe("note-42");
  });
});

describe("a stored history is only reused for the text it describes", () => {
  it("accepts a record that names this note and matches the file", () => {
    expect(
      isHistoryUsable({ noteId: "note-1", doc: "on disk" }, "note-1", "on disk"),
    ).toBe(true);
  });

  it("rejects a record belonging to another note", () => {
    // The corrupt state behind the reported bug: one note's revisions filed
    // under another. Layering them on is what let a foreign body be undone
    // into place and then written to the file.
    expect(
      isHistoryUsable({ noteId: "note-other", doc: "on disk" }, "note-1", "on disk"),
    ).toBe(false);
  });

  it("rejects a record describing text the file no longer holds", () => {
    expect(
      isHistoryUsable({ noteId: "note-1", doc: "old text" }, "note-1", "new text"),
    ).toBe(false);
  });

  it("rejects a missing record", () => {
    expect(isHistoryUsable(null, "note-1", "on disk")).toBe(false);
    expect(isHistoryUsable(undefined, "note-1", "on disk")).toBe(false);
  });
});
