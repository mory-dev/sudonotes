/**
 * The cloud (prompt) and leaf (idea) marks, paths verbatim from
 * app/src/components/NoteMarks.tsx.
 *
 * They live here rather than in NoteMark.astro because the marks now appear
 * outside the window previews too — in the hero headline and in the diagrams —
 * and three hand-copied duplicates would be three chances to drift from the app.
 */

export const CLOUD = "M4.3 12.2h7.6a2.5 2.5 0 0 0 .4-4.97 3.8 3.8 0 0 0-7.3-.9 2.9 2.9 0 0 0-.7 5.87Z";

export const LEAF =
  "M13.2 2.8c-4.6.1-8 2.6-9.5 5.8-.8 1.7-.6 3.4.1 4.2.9.9 3.6.4 5.5-.9 1.4-.9 2.4-2.6 3.2-4.3.6-1.3.9-2.8.7-4.8Z";

export const LEAF_VEIN = "M3.9 13.1c2.7-2.9 5.5-5.7 7.7-8";
