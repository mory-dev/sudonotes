import type { EditorState } from "@codemirror/state";

export interface CachedEditorState {
  /** The note this document belongs to, recorded so an entry can be checked
   *  against the slot it is stored in rather than trusted because of it. */
  noteId: string;
  state: EditorState;
  scrollTop: number;
  updatedAt: number;
}

/**
 * Tier-1 In-Memory LRU Cache for EditorState.
 * Holds active CodeMirror EditorState instances and scroll positions
 * for up to `maxEntries` (default 50) notes to ensure instant note switching
 * without losing undo/redo stacks or scroll positions.
 *
 * Every entry names its own note. A cache keyed by note id but holding states
 * nobody had checked let one note's text — and its undo history — be restored
 * as another note and written to that note's file, so both the key and the
 * entry have to agree before anything comes back out.
 */
export class EditorStateCache {
  private readonly maxEntries: number;
  private readonly cache = new Map<string, CachedEditorState>();

  constructor(maxEntries = 50) {
    this.maxEntries = maxEntries;
  }

  get(id: string): CachedEditorState | undefined {
    const entry = this.cache.get(id);
    if (!entry) return undefined;
    // An entry filed under the wrong note is corrupt, not stale: dropping it
    // costs an undo history, keeping it costs the note's contents.
    if (entry.noteId !== id) {
      this.cache.delete(id);
      return undefined;
    }
    // Refresh LRU order (delete & re-insert)
    this.cache.delete(id);
    const refreshed: CachedEditorState = { ...entry, updatedAt: Date.now() };
    this.cache.set(id, refreshed);
    return refreshed;
  }

  set(id: string, entry: Omit<CachedEditorState, "updatedAt"> & { updatedAt?: number }): void {
    // Refuse the write outright rather than store a mislabelled entry.
    if (entry.noteId !== id) {
      throw new Error(
        `editorStateCache: refusing to file note ${entry.noteId} under ${id}`,
      );
    }
    if (this.cache.has(id)) {
      this.cache.delete(id);
    } else if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(id, {
      noteId: entry.noteId,
      state: entry.state,
      scrollTop: entry.scrollTop,
      updatedAt: entry.updatedAt ?? Date.now(),
    });
  }

  has(id: string): boolean {
    return this.cache.has(id);
  }

  delete(id: string): boolean {
    return this.cache.delete(id);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  entries(): IterableIterator<[string, CachedEditorState]> {
    return this.cache.entries();
  }
}

export const editorStateCache = new EditorStateCache(50);
