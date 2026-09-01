import type { EditorState } from "@codemirror/state";

export interface CachedEditorState {
  state: EditorState;
  scrollTop: number;
  updatedAt: number;
}

/**
 * Tier-1 In-Memory LRU Cache for EditorState.
 * Holds active CodeMirror EditorState instances and scroll positions
 * for up to `maxEntries` (default 50) notes to ensure instant note switching
 * without losing undo/redo stacks or scroll positions.
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
    // Refresh LRU order (delete & re-insert)
    this.cache.delete(id);
    const refreshed: CachedEditorState = { ...entry, updatedAt: Date.now() };
    this.cache.set(id, refreshed);
    return refreshed;
  }

  set(id: string, entry: Omit<CachedEditorState, "updatedAt"> & { updatedAt?: number }): void {
    if (this.cache.has(id)) {
      this.cache.delete(id);
    } else if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(id, {
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
