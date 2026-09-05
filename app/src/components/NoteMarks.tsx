/** Visual marks for the two note types — a cloud for prompts, a leaf for
 *  ideas — and the vault scratch dump. Used wherever a note's type is identified. */

import type { NoteType } from "../api";

export function PromptMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.3 12.2h7.6a2.5 2.5 0 0 0 .4-4.97 3.8 3.8 0 0 0-7.3-.9 2.9 2.9 0 0 0-.7 5.87Z" />
    </svg>
  );
}

export function IdeaMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13.2 2.8c-4.6.1-8 2.6-9.5 5.8-.8 1.7-.6 3.4.1 4.2.9.9 3.6.4 5.5-.9 1.4-.9 2.4-2.6 3.2-4.3.6-1.3.9-2.8.7-4.8Z" />
      <path d="M3.9 13.1c2.7-2.9 5.5-5.7 7.7-8" />
    </svg>
  );
}

/** A ring around a void — the vault scratch dump, not a note type. */
export function BlackholeMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.4" />
      <circle cx="8" cy="8" r="2.1" />
    </svg>
  );
}

/** A small volume pyramid: wider levels represent more bubbles. */
export function VolumePyramidMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    >
      <path d="M6.4 3h3.2M4.8 6h6.4M3.2 9h9.6M1.8 12h12.4" />
    </svg>
  );
}

/** The colored chip with a mark, used to label a note's type. */
export function TypeBadge({ type }: { type: NoteType }) {
  return (
    <span className={`badge ${type}`}>
      {type === "prompt" ? <PromptMark /> : <IdeaMark />}
      {type}
    </span>
  );
}
