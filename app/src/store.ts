import { create } from "zustand";

import {
  api,
  type AiSettings,
  type ChildPrompt,
  type DraftPrompt,
  type NoteDetail,
  type NoteMeta,
  type NoteType,
} from "./api";

const SAVE_DEBOUNCE_MS = 500;

/** Debounced-save bookkeeping. The note id travels with the pending body so a
 *  save can never land on the wrong note after the user switches away. */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pending: { id: string; body: string } | null = null;

const message = (e: unknown) => (typeof e === "string" ? e : String(e));

/** The old placeholder a fresh note used to be created with. */
const DEFAULT_TITLE = "Untitled";

/** True for auto-assigned placeholder titles ("Prompt 3", "Idea 2",
 *  "Untitled") that should be replaced by the note's first line on first edit. */
function isPlaceholderTitle(title: string): boolean {
  return title === DEFAULT_TITLE || /^(prompt|idea)\s+\d+$/i.test(title.trim());
}

/** The next free default title for a note type: "Prompt 1", "Idea 2", … */
function nextDefaultTitle(noteType: NoteType, notes: NoteMeta[]): string {
  const prefix = noteType === "prompt" ? "Prompt" : "Idea";
  const re = new RegExp(`^${prefix}\\s+(\\d+)$`, "i");
  let max = 0;
  for (const note of notes) {
    if (note.type !== noteType) continue;
    const match = note.title.match(re);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `${prefix} ${max + 1}`;
}

/** First non-blank line of a body, markdown heading markers stripped, which
 *  becomes the title of a freshly created note. */
function titleFromFirstLine(body: string): string {
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    return line.replace(/^#{1,6}\s+/, "").trim();
  }
  return "";
}

export interface DialogOption {
  label: string;
  description?: string;
  /** Styles the button as destructive (red). */
  danger?: boolean;
  onSelect: () => void;
}

export interface DialogRequest {
  message: string;
  options: DialogOption[];
  cancelLabel?: string;
}

interface AppState {
  vaultPath: string | null;
  notes: NoteMeta[];
  active: NoteDetail | null;
  backlinks: NoteMeta[];
  /** Prompts filed under the open note, when it heads a collection. */
  children: ChildPrompt[];
  /** Bumped when the active note's text is replaced from disk, so the editor reloads. */
  docVersion: number;
  paletteOpen: boolean;
  /** Initial search query for the next palette opening (e.g. a clicked tag). */
  paletteQuery: string;
  /** A pending styled confirmation, shown as a modal instead of a native dialog. */
  confirm: DialogRequest | null;
  /** Right-click menu position in the editor, or null when closed. */
  menuAt: { x: number; y: number; hasSelection: boolean; link: string | null } | null;
  linkPickerOpen: boolean;
  /** A note title the editor should insert as a [[link]], then clear. */
  insertLink: string | null;
  /** Scroll the editor to a position in the open note, then clear. */
  scrollTo: { id: string; pos: number } | null;
  /** In-editor find state (Ctrl+Shift+F), or null when closed. */
  find: { query: string; index: number; move: boolean } | null;
  /** Number of matches, updated by the editor's find plugin. */
  findCount: number;
  dirty: boolean;
  error: string | null;
  notice: string | null;
  /** Prompts detected in a paste, awaiting confirmation. Nothing is on disk yet. */
  drafts: DraftPrompt[] | null;
  /** The raw pasted text, so the split can consume exactly it and no more. */
  pastedText: string;
  aiSettings: AiSettings;
  /** Whether the AI proxy actually answered. null until a call has been tried —
   *  the settings only say AI is *configured*, never that it is reachable. */
  aiReachable: boolean | null;
  /** Records the outcome of an AI call so the UI can stop claiming it works. */
  noteAiResult: (ok: boolean) => void;

  openVault: (path: string) => Promise<void>;
  restoreVault: () => Promise<void>;
  refresh: () => Promise<void>;
  select: (id: string | null) => Promise<void>;
  create: (noteType: NoteType, title: string) => Promise<void>;
  /** Add a prompt to the open collection and open it in the editor. */
  addPrompt: () => Promise<void>;
  /** Reorder a collection's children (drag & drop) and persist the order. */
  reorderChildren: (parentId: string, ordered: string[]) => Promise<void>;
  /** A paste landing in the collection view: split it into several prompts, or
   *  add it as a single prompt when it has no structure to split. */
  pasteIntoCollection: (text: string) => Promise<void>;
  queueSave: (id: string, body: string) => void;
  updateModel: (model: string | null) => Promise<void>;
  /** Assign a model to the bubble whose first line is `key`. */
  setBubbleModel: (key: string, model: string | null) => Promise<void>;
  flushSave: () => Promise<void>;
  rename: (title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  returnToCollection: () => Promise<void>;
  openLink: (title: string) => Promise<void>;
  reloadExternal: () => Promise<void>;
  confirmSplit: (drafts: DraftPrompt[]) => Promise<void>;
  cancelSplit: () => void;
  setPalette: (open: boolean) => void;
  /** Open the search palette pre-filled with a query (from a clicked tag). */
  openPalette: (query: string) => void;
  requestConfirm: (message: string, onConfirm: () => void, confirmLabel?: string) => void;
  requestChoice: (request: DialogRequest) => void;
  cancelConfirm: () => void;
  openMenu: (at: { x: number; y: number; hasSelection: boolean; link: string | null }) => void;
  closeMenu: () => void;
  setLinkPicker: (open: boolean) => void;
  requestLink: (title: string | null) => void;
  scrollToPos: (pos: number) => void;
  clearScroll: () => void;
  openFind: () => void;
  closeFind: () => void;
  setFindQuery: (query: string) => void;
  findMove: (dir: 1 | -1) => void;
  setError: (error: string | null) => void;
  setNotice: (notice: string | null) => void;
  loadAiSettings: () => Promise<void>;
  saveAiSettings: (enabled: boolean) => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  vaultPath: null,
  notes: [],
  active: null,
  backlinks: [],
  children: [],
  docVersion: 0,
  paletteOpen: false,
  paletteQuery: "",
  confirm: null,
  menuAt: null,
  linkPickerOpen: false,
  insertLink: null,
  scrollTo: null,
  find: null,
  findCount: 0,
  dirty: false,
  error: null,
  notice: null,
  drafts: null,
  pastedText: "",
  aiSettings: { enabled: true, configured: true },
  aiReachable: null,

  noteAiResult: (ok) => {
    if (get().aiReachable === ok) return;
    set({ aiReachable: ok });
    if (!ok) {
      set({
        notice:
          "AI features are unreachable — the sudonotes API is not deployed yet. Falling back to local behaviour.",
      });
    }
  },

  setPalette: (paletteOpen) => set({ paletteOpen, paletteQuery: paletteOpen ? get().paletteQuery : "" }),
  openPalette: (query) => set({ paletteOpen: true, paletteQuery: query }),
  requestConfirm: (message, onConfirm, confirmLabel = "Confirm") =>
    set({
      confirm: {
        message,
        options: [{ label: confirmLabel, danger: true, onSelect: onConfirm }],
        cancelLabel: "Cancel",
      },
    }),
  requestChoice: (confirm) => set({ confirm }),
  cancelConfirm: () => set({ confirm: null }),
  openMenu: (menuAt) => set({ menuAt }),
  closeMenu: () => set({ menuAt: null }),
  setLinkPicker: (linkPickerOpen) => set({ linkPickerOpen, menuAt: null }),
  requestLink: (insertLink) => set({ insertLink, linkPickerOpen: false }),
  scrollToPos: (pos) => {
    const active = get().active;
    if (active) set({ scrollTo: { id: active.id, pos } });
  },
  clearScroll: () => set({ scrollTo: null }),
  openFind: () => set({ find: { query: "", index: 0, move: false } }),
  closeFind: () => set({ find: null }),
  setFindQuery: (query) => set({ find: { query, index: 0, move: false } }),
  findMove: (dir) => {
    const find = get().find;
    const count = get().findCount;
    if (!find || count === 0) return;
    const next = (find.index + dir + count) % count;
    set({ find: { ...find, index: next, move: true } });
  },
  setError: (error) => set({ error }),
  setNotice: (notice) => set({ notice }),

  loadAiSettings: async () => {
    try {
      set({ aiSettings: await api.getAiSettings() });
    } catch {
      // AI is optional; a missing keychain backend must not block the vault.
    }
  },

  saveAiSettings: async (enabled) => {
    try {
      set({ aiSettings: await api.setAiSettings(enabled) });
    } catch (e) {
      set({ error: message(e) });
    }
  },

  openVault: async (path) => {
    try {
      const resolved = await api.openVault(path);
      set({ vaultPath: resolved, active: null, backlinks: [], error: null });
      await get().refresh();
    } catch (e) {
      set({ error: message(e) });
    }
  },

  restoreVault: async () => {
    const previous = await api.lastVault().catch(() => null);
    if (previous) await get().openVault(previous);
  },

  refresh: async () => {
    try {
      const notes = await api.listNotes();
      const activeId = get().active?.id;
      const [backlinks, children] = activeId
        ? await Promise.all([api.backlinks(activeId), api.collectionChildren(activeId)])
        : [[], []];
      set({ notes, backlinks, children });
    } catch (e) {
      set({ error: message(e) });
    }
  },

  select: async (id) => {
    await get().flushSave();
    if (!id) {
      set({ active: null, backlinks: [], children: [] });
      return;
    }
    try {
      const [active, backlinks, children] = await Promise.all([
        api.readNote(id),
        api.backlinks(id),
        api.collectionChildren(id),
      ]);
      set({
        active,
        backlinks,
        children,
        scrollTo: null,
        find: null,
        dirty: false,
        docVersion: get().docVersion + 1,
        error: null,
      });
    } catch (e) {
      set({ error: message(e) });
    }
  },

  create: async (noteType, title) => {
    try {
      const finalTitle = title.trim() || nextDefaultTitle(noteType, get().notes);
      const id = await api.createNote(noteType, finalTitle);
      await get().refresh();
      await get().select(id);
    } catch (e) {
      set({ error: message(e) });
    }
  },

  addPrompt: async () => {
    const active = get().active;
    // Ideas head collections too, so their blocks can each name a model.
    if (!active || active.collection) return;
    try {
      const id = await api.createChild(
        active.id,
        nextDefaultTitle(active.type, get().notes),
        "",
      );
      await get().refresh();
      await get().select(id);
    } catch (e) {
      set({ error: message(e) });
    }
  },

  reorderChildren: async (parentId, ordered) => {
    try {
      await api.reorderChildren(parentId, ordered);
      await get().refresh();
      // Reload the open bucket so its index reflects the new order.
      const active = get().active;
      if (active?.id === parentId) await get().select(parentId);
    } catch (e) {
      set({ error: message(e) });
    }
  },

  pasteIntoCollection: async (text) => {
    const active = get().active;
    if (!active || active.collection) return;
    if (!text.trim()) return;
    try {
      const drafts = await api.splitPreview(text);
      if (drafts.length > 1) {
        set({ drafts, pastedText: text });
        return;
      }
      // Prefer a short LLM-generated title over the (possibly long) first line.
      let title = titleFromFirstLine(text) || nextDefaultTitle(active.type, get().notes);
      if (get().aiSettings.enabled && get().aiSettings.configured) {
        const suggested = await api
          .suggestTitle(text)
          .then((value) => {
            get().noteAiResult(true);
            return value;
          })
          .catch(() => {
            get().noteAiResult(false);
            return "";
          });
        if (suggested.trim()) title = suggested.trim();
      }
      const id = await api.createChild(active.id, title, text);
      await get().refresh();
      await get().select(id);
    } catch (e) {
      set({ error: message(e) });
    }
  },

  queueSave: (id, body) => {
    pending = { id, body };
    set({ dirty: true });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().flushSave(), SAVE_DEBOUNCE_MS);
  },

  updateModel: async (model) => {
    const active = get().active;
    if (!active) return;
    try {
      await api.updateModel(active.id, model);
      set({ active: { ...active, model } });
      await get().refresh();
    } catch (e) {
      set({ error: message(e) });
    }
  },

  setBubbleModel: async (key, model) => {
    const active = get().active;
    if (!active) return;
    try {
      const models = await api.setBubbleModel(active.id, key, model ?? "");
      set({ active: { ...active, models } });
      await get().refresh();
    } catch (e) {
      set({ error: message(e) });
    }
  },

  flushSave: async () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const write = pending;
    pending = null;
    if (!write) return;

    try {
      await api.writeNote(write.id, write.body);
      // Keep the in-memory copy in step so re-selecting the note is a no-op.
      const active = get().active;
      if (active?.id === write.id) {
        set({ active: { ...active, body: write.body } });
      }
      set({ dirty: false });
      await get().refresh();

      // A fresh note takes its title from the first line it grows, until the
      // user renames it by hand.
      const current = get().active;
      const title = titleFromFirstLine(write.body);
      if (
        current?.id === write.id &&
        isPlaceholderTitle(current.title) &&
        title &&
        !isPlaceholderTitle(title)
      ) {
        await get().rename(title);
      }
      if (get().aiSettings.enabled) {
        void api
          .autoTagNote(write.id)
          .then((tags) => {
            get().noteAiResult(true);
            const current = get().active;
            if (current?.id === write.id) {
              set({ active: { ...current, tags } });
            }
            return get().refresh();
          })
          .catch(() => get().noteAiResult(false));
      }
    } catch (e) {
      set({ error: message(e) });
    }
  },

  rename: async (title) => {
    const active = get().active;
    if (!active) return;
    try {
      await api.renameNote(active.id, title);
      set({ active: { ...active, title } });
      await get().refresh();
    } catch (e) {
      set({ error: message(e) });
    }
  },

  remove: async (id) => {
    try {
      await api.deleteNote(id);
      if (get().active?.id === id) set({ active: null, backlinks: [] });
      await get().refresh();
      // A deleted child leaves its parent's index one link shorter; reload the
      // open bucket so its body reflects that instead of showing a dead link.
      const active = get().active;
      if (active && active.id !== id && active.type === "prompt" && !active.collection) {
        await get().select(active.id);
      }
    } catch (e) {
      set({ error: message(e) });
    }
  },

  returnToCollection: async () => {
    const collection = get().active?.collection;
    if (!collection) return;
    await get().flushSave();
    await get().openLink(collection);
  },

  /** Something changed on disk outside the app: resync, and reload the open
   *  note unless the user has unsaved edits that would be clobbered. */
  reloadExternal: async () => {
    await get().refresh();

    const active = get().active;
    if (!active || get().dirty) return;

    try {
      const fresh = await api.readNote(active.id);
      if (fresh.body !== active.body || fresh.title !== active.title) {
        set({ active: fresh, docVersion: get().docVersion + 1 });
      }
    } catch {
      // The note was deleted or moved while it was open.
      set({ active: null, backlinks: [] });
    }
  },

  confirmSplit: async (drafts) => {
    const active = get().active;
    if (!active) return;
    try {
      // The paste is still sitting unsaved in the editor; the split rewrites
      // this note from scratch, so drop the pending save first.
      await get().flushSave();
      const count = await api.applySplit(active.id, drafts, get().pastedText);
      set({ drafts: null, pastedText: "" });
      await get().refresh();
      await get().select(active.id);
      set({ notice: `Split into ${count} prompts` });
    } catch (e) {
      set({ drafts: null, error: message(e) });
    }
  },

  cancelSplit: () => set({ drafts: null, pastedText: "" }),

  openLink: async (title) => {
    try {
      const id = await api.resolveLink(title);
      if (id) {
        await get().select(id);
      } else {
        set({ error: `No note titled "${title}"` });
      }
    } catch (e) {
      set({ error: message(e) });
    }
  },
}));
