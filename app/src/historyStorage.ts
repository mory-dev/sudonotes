import { historyField } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";

import { noteIdField, noteIdOf } from "./noteIdField";

export interface HistoryRecord {
  key: string;
  vaultPath: string;
  noteId: string;
  doc: string;
  historyJSON: Record<string, unknown>;
  scrollTop: number;
  updatedAt: number;
}

const DB_NAME = "sudonotes-history-db";
const DB_VERSION = 1;
const STORE_NAME = "history";

let dbPromise: Promise<IDBDatabase | null> | null = null;
let pruneScheduled = false;

function getIndexedDB(): IDBFactory | null {
  if (typeof window !== "undefined" && window.indexedDB) {
    return window.indexedDB;
  }
  if (typeof indexedDB !== "undefined") {
    return indexedDB;
  }
  return null;
}

export function openHistoryDB(): Promise<IDBDatabase | null> {
  const idb = getIndexedDB();
  if (!idb) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const request = idb.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
          store.createIndex("vaultPath", "vaultPath", { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (!pruneScheduled) {
          pruneScheduled = true;
          // Prune asynchronously shortly after startup
          const pt = setTimeout(() => {
            void pruneHistory();
          }, 3000);
          (pt as unknown as { unref?: () => void })?.unref?.();
        }
        resolve(db);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

/**
 * Key format: `sudonotes:history:<vaultPath>:<noteId>`
 */
export function buildHistoryKey(vaultPath: string | null | undefined, noteId: string): string {
  const vault = vaultPath ? vaultPath.trim() : "default";
  return `sudonotes:history:${vault}:${noteId}`;
}

/** The fields carried through serialisation. `noteId` rides along so a restored
 *  document still knows which note it belongs to and can be checked against the
 *  note it is being restored into. */
const SERIALISED_FIELDS = { history: historyField, noteId: noteIdField };

export function serializeHistoryState(
  state: EditorState,
  scrollTop = 0,
): { historyJSON: Record<string, unknown>; doc: string; scrollTop: number } {
  const historyJSON = state.toJSON(SERIALISED_FIELDS);
  return {
    historyJSON,
    doc: state.doc.toString(),
    scrollTop,
  };
}

export function deserializeHistoryState(
  historyJSON: Record<string, unknown>,
  extensions: Extension[],
): EditorState | null {
  try {
    return EditorState.fromJSON(historyJSON, { extensions }, SERIALISED_FIELDS);
  } catch {
    return null;
  }
}

/**
 * Save history immediately to IndexedDB.
 */
export async function saveHistoryImmediate(
  vaultPath: string | null | undefined,
  noteId: string,
  state: EditorState,
  scrollTop = 0,
): Promise<void> {
  // The document says which note it is. Writing it under a different one would
  // persist a history that can later be restored onto the wrong note, so the
  // mismatch is refused here rather than discovered on the way back out.
  const stateNoteId = noteIdOf(state);
  if (stateNoteId !== null && stateNoteId !== noteId) {
    console.warn(
      "sudonotes: refusing to store history for",
      stateNoteId,
      "under",
      noteId,
    );
    return;
  }

  const db = await openHistoryDB();
  if (!db) return;

  const key = buildHistoryKey(vaultPath, noteId);
  const { historyJSON, doc } = serializeHistoryState(state, scrollTop);
  const record: HistoryRecord = {
    key,
    vaultPath: vaultPath ? vaultPath.trim() : "default",
    noteId,
    doc,
    historyJSON,
    scrollTop,
    updatedAt: Date.now(),
  };

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

const pendingHistorySaves = new Map<
  string,
  {
    vaultPath: string | null | undefined;
    noteId: string;
    state: EditorState;
    scrollTop: number;
    timer: ReturnType<typeof setTimeout>;
  }
>();

/**
 * Asynchronous, debounced history save to IndexedDB.
 */
export function saveHistoryDebounced(
  vaultPath: string | null | undefined,
  noteId: string,
  state: EditorState,
  scrollTop = 0,
  delayMs = 500,
): void {
  const key = buildHistoryKey(vaultPath, noteId);
  const existing = pendingHistorySaves.get(key);
  if (existing) {
    clearTimeout(existing.timer);
  }

  const timer = setTimeout(() => {
    pendingHistorySaves.delete(key);
    void saveHistoryImmediate(vaultPath, noteId, state, scrollTop);
  }, delayMs);
  (timer as unknown as { unref?: () => void })?.unref?.();

  pendingHistorySaves.set(key, { vaultPath, noteId, state, scrollTop, timer });
}

/**
 * Flush any pending debounced history saves immediately.
 */
export async function flushPendingHistory(): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const [key, pending] of pendingHistorySaves.entries()) {
    clearTimeout(pending.timer);
    pendingHistorySaves.delete(key);
    promises.push(
      saveHistoryImmediate(
        pending.vaultPath,
        pending.noteId,
        pending.state,
        pending.scrollTop,
      ),
    );
  }
  await Promise.all(promises);
}

/**
 * Load raw history record from IndexedDB.
 */
export async function loadHistory(
  vaultPath: string | null | undefined,
  noteId: string,
): Promise<HistoryRecord | null> {
  const db = await openHistoryDB();
  if (!db) return null;

  const key = buildHistoryKey(vaultPath, noteId);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => resolve((request.result as HistoryRecord) || null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Whether a stored history may be restored into `noteId`, whose body on disk
 *  is `currentDoc`.
 *
 *  Both conditions matter. The record must name this note, and the document it
 *  describes must be the one on disk — a history is a list of edits relative to
 *  a specific text, so against any other text its entries are meaningless at
 *  best and another note's content at worst. */
export function isHistoryUsable(
  record: { noteId?: string; doc?: string } | null | undefined,
  noteId: string,
  currentDoc: string,
): boolean {
  if (!record) return false;
  if (record.noteId !== undefined && record.noteId !== noteId) return false;
  return record.doc === currentDoc;
}

/**
 * On cold launch or cache miss, rehydrate EditorState from IndexedDB.
 *
 * The restored history is only offered when it describes exactly the text that
 * is on disk for this note. Previously a record whose document had moved on was
 * rebased — the current body was inserted over the stored one so undo still
 * worked — which meant a record holding a *different note's* revisions kept
 * them in the stack, one Ctrl+Z away from being restored and autosaved over
 * this note. There is no safe way to reuse a history that does not belong to
 * the text, so it is dropped and the caller starts a fresh document.
 */
export async function loadHistoryState(
  vaultPath: string | null | undefined,
  noteId: string,
  currentDoc: string,
  extensions: Extension[],
): Promise<{ state: EditorState; scrollTop: number } | null> {
  const record = await loadHistory(vaultPath, noteId);
  if (!record || !record.historyJSON) return null;

  if (!isHistoryUsable(record, noteId, currentDoc)) {
    // Stale or foreign. Discarded rather than adapted, so it cannot be undone
    // back into the file.
    await deleteHistory(vaultPath, noteId);
    return null;
  }

  const restored = deserializeHistoryState(record.historyJSON, extensions);
  if (!restored) return null;

  // Last check, on the restored document itself rather than on the record's own
  // summary of it. A history written before the id was serialised has no id to
  // check, and is dropped for the same reason: there is no way to tell whose
  // edits it holds.
  if (restored.doc.toString() !== currentDoc || noteIdOf(restored) !== noteId) {
    await deleteHistory(vaultPath, noteId);
    return null;
  }

  return { state: restored, scrollTop: record.scrollTop || 0 };
}

/**
 * Automatically prune records older than 30 days or beyond 100 notes.
 */
export async function pruneHistory(
  maxAgeDays = 30,
  maxRecords = 100,
): Promise<void> {
  const db = await openHistoryDB();
  if (!db) return;

  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const records = (request.result as HistoryRecord[]) || [];
        const validRecords: HistoryRecord[] = [];

        for (const record of records) {
          if (record.updatedAt < cutoff) {
            store.delete(record.key);
          } else {
            validRecords.push(record);
          }
        }

        if (validRecords.length > maxRecords) {
          validRecords.sort((a, b) => b.updatedAt - a.updatedAt);
          const toDelete = validRecords.slice(maxRecords);
          for (const record of toDelete) {
            store.delete(record.key);
          }
        }
        resolve();
      };
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Delete history for a specific note.
 */
export async function deleteHistory(
  vaultPath: string | null | undefined,
  noteId: string,
): Promise<void> {
  const db = await openHistoryDB();
  if (!db) return;
  const key = buildHistoryKey(vaultPath, noteId);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.delete(key);
      resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Clear all history (useful for testing or full vault purge).
 */
export async function clearAllHistory(): Promise<void> {
  const db = await openHistoryDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      resolve();
    } catch {
      resolve();
    }
  });
}
