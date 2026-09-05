import { StateEffect, StateField } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";

/** Rebind the document in the editor to a note. */
export const setNoteId = StateEffect.define<string | null>();

/**
 * The id of the note a document belongs to, carried *inside* the EditorState.
 *
 * The id used to live beside the document, in a ref resynced by an effect, so
 * "which note is this text?" was answered by a variable the text knew nothing
 * about. Whenever the two fell out of step — a switch that assigned the id
 * before replacing the document, an exception mid-swap — a keystroke was filed
 * under the wrong note and one note's body overwrote another's. Held in the
 * state, the id can only travel with the text it belongs to: any snapshot of
 * the document carries its own identity, so a save cannot misattribute it.
 */
export const noteIdField = StateField.define<string | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setNoteId)) return effect.value;
    }
    return value;
  },
  toJSON: (value) => value,
  fromJSON: (value) => (typeof value === "string" ? value : null),
});

/** The note this document belongs to, or null if it was never bound. */
export function noteIdOf(state: EditorState): string | null {
  return state.field(noteIdField, false) ?? null;
}

/** Whether `state` holds the text of `id` and may be saved under it. */
export function documentBelongsTo(state: EditorState, id: string): boolean {
  return noteIdOf(state) === id;
}
