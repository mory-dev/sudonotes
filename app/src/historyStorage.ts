import { historyField } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";

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

export function serializeHistoryState(
  state: EditorState,
  scrollTop = 0,
): { historyJSON: Record<string, unknown>; doc: string; scrollTop: number } {
  const historyJSON = state.toJSON({ history: historyField });
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
    return EditorState.fromJSON(
      historyJSON,
      { extensions },
      { history: historyField },
    );
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

/**
 * On cold launch or cache miss, rehydrate EditorState from IndexedDB.
 * If the document matches, returns the deserialized state with preserved history.
 * If the document changed externally, applies changes over the restored state to retain undo history.
 */
export async function loadHistoryState(
  vaultPath: string | null | undefined,
  noteId: string,
  currentDoc: string,
  extensions: Extension[],
): Promise<{ state: EditorState; scrollTop: number } | null> {
  const record = await loadHistory(vaultPath, noteId);
  if (!record || !record.historyJSON) return null;

  const restored = deserializeHistoryState(record.historyJSON, extensions);
  if (!restored) return null;

  if (restored.doc.toString() === currentDoc) {
    return { state: restored, scrollTop: record.scrollTop || 0 };
  }

  // Document changed externally on disk: update cached state using changes to preserve history
  try {
    const updated = restored.update({
      changes: { from: 0, to: restored.doc.length, insert: currentDoc },
    }).state;
    return { state: updated, scrollTop: record.scrollTop || 0 };
  } catch {
    return null;
  }
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
