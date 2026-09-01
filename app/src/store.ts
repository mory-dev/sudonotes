import { create } from "zustand";

import {
  api,
  type AiSettings,
  type AnalysisResult,
  type ChildPrompt,
  type DraftPrompt,
  type GithubAuth,
  type IdeaMarkState,
  type IssueRef,
  type NoteDetail,
  type NoteMeta,
  type NoteType,
} from "./api";

const SAVE_DEBOUNCE_MS = 500;

/** Auto-tagging costs a network round trip, and saves are frequent. The debounce
 *  above is not enough on its own: a note must carry some substance, must have
 *  changed by more than a typo since it was last tagged, and must not have been
 *  tagged in the last minute. */
const AUTO_TAG_MIN_CHARS = 80;
const AUTO_TAG_MIN_DELTA = 200;
const AUTO_TAG_COOLDOWN_MS = 60_000;

/** Per note: when it was last auto-tagged and how long it was at the time. */
const tagged = new Map<string, { at: number; length: number }>();

/** Hover grace period timer for prompt collection cards, allowing the user
 *  to smoothly move the cursor across the gap into the right details panel. */
let hoverPromptTimer: ReturnType<typeof setTimeout> | null = null;
const HOVER_GRACE_MS = 450;

function shouldAutoTag(id: string, body: string): boolean {
  const length = body.trim().length;
  if (length < AUTO_TAG_MIN_CHARS) return false;
  const last = tagged.get(id);
  if (!last) return true;
  if (Date.now() - last.at < AUTO_TAG_COOLDOWN_MS) return false;
  return Math.abs(length - last.length) >= AUTO_TAG_MIN_DELTA;
}

/** Debounced-save bookkeeping. The note id travels with the pending body so a
 *  save can never land on the wrong note after the user switches away. */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pending: { id: string; body: string } | null = null;
let pendingMigrations: Array<{ id: string; oldKey: string; newKey: string }> = [];

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
/** The blank-line separated blocks of an idea body, as ranges, plus one range
 *  per explicit `<!-- bubble -->` pair. The same grouping the editor draws
 *  bubbles around and the sidebar outlines, so a move made from either place
 *  lands on the same block. */
function bubbleRanges(body: string): { from: number; to: number }[] {
  const pairs = bubbleMarkerPairs(body);
  const out: { from: number; to: number }[] = [];
  let from = -1;
  let offset = 0;

  for (const line of body.split("\n")) {
    // Marker pairs own everything between their lines: never start or extend a
    // blank-line bubble across them.
    if (pairs.some((p) => offset >= p.from && offset <= p.to)) {
      if (from >= 0) {
        out.push({ from, to: offset - 1 });
        from = -1;
      }
    } else if (line.trim() === "") {
      if (from >= 0) {
        // Ends at the previous line's last character, not at this blank one.
        out.push({ from, to: offset - 1 });
        from = -1;
      }
    } else if (from < 0) {
      from = offset;
    }
    offset += line.length + 1;
  }
  if (from >= 0) out.push({ from, to: body.length });

  out.push(...pairs);
  out.sort((a, b) => a.from - b.from);
  return out;
}

/** A bubble can be delimited explicitly by these marker lines, so a block of
 *  text keeps every blank line and still reads as one bubble. The markers are
 *  ordinary HTML comments: invisible in any rendered markdown, meaningful only
 *  to sudonotes. Blank-line rules apply outside marker pairs. */
export const BUBBLE_START = "<!-- bubble -->";
export const BUBBLE_END = "<!-- /bubble -->";

/** The `<!-- bubble -->` … `<!-- /bubble -->` pairs in a body, as {from, to}
 *  doc offsets that include both marker lines. Unmatched markers are plain
 *  comments. */
export function bubbleMarkerPairs(body: string): { from: number; to: number }[] {
  const pairs: { from: number; to: number }[] = [];
  let start = -1;
  let offset = 0;
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (t === BUBBLE_START && start < 0) {
      start = offset;
    } else if (t === BUBBLE_END && start >= 0) {
      pairs.push({ from: start, to: offset + line.length });
      start = -1;
    }
    offset += line.length + 1;
  }
  return pairs;
}

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
  /** Whether the settings dialog, opened from the status bar, is showing. */
  settingsOpen: boolean;
  /** The bubble whose GitHub issue is being drafted, or null when closed. */
  issueDraft: { noteId: string; label: string } | null;
  /** Right-click menu position in the editor, or null when closed. */
  menuAt: {
    x: number;
    y: number;
    hasSelection: boolean;
    link: string | null;
    /** The note the menu was opened on, when the right-click hit a sidebar row. */
    note: { id: string; title: string; type: NoteType } | null;
    /** The idea bubble the menu was opened on, when it hit the sidebar outline. */
    bubble: { label: string; start: number } | null;
  } | null;
  linkPickerOpen: boolean;
  /** A note title the editor should insert as a [[link]], then clear. */
  insertLink: string | null;
  /** Bumped when the context menu asks the editor to merge the selection
   *  into one bubble; the editor consumes the bump. */
  mergeSelection: number;
  /** Scroll the editor to a position in the open note, then clear. */
  scrollTo: { id: string; pos: number } | null;
  /** In-editor find state (Ctrl+Shift+F), or null when closed. */
  find: { query: string; index: number; move: boolean } | null;
  /** Incremented whenever Ctrl+Shift+F requests focus, including when find is already open. */
  findFocus: number;
  /** Number of matches, updated by the editor's find plugin. */
  findCount: number;
  /** The idea bubble under the mouse, and the one holding the cursor, by their
   *  heading text. The right panel shows whichever is live — hover wins, and
   *  the cursor is what it falls back to when the mouse is elsewhere. */
  hoverBubble: string | null;
  cursorBubble: string | null;
  /** The child prompt currently hovered in the prompt collection view. */
  hoverPrompt: ChildPrompt | null;
  dirty: boolean;
  error: string | null;
  notice: string | null;
  /** An action offered alongside the current notice, cleared with it. */
  noticeAction: { label: string; run: () => void } | null;
  /** Prompts detected in a paste, awaiting confirmation. Nothing is on disk yet. */
  drafts: DraftPrompt[] | null;
  /** The raw pasted text, so the split can consume exactly it and no more. */
  pastedText: string;
  /** Armed by the global keydown handler on Mod+Shift+V so the paste that
   *  follows can be pasted as one block — ClipboardEvent carries no modifiers.
   *  Disarmed by any other key and consumed by the paste handlers. */
  oneBlockPaste: boolean;
  aiSettings: AiSettings;
  /** GitHub sign-in state, loaded once at boot. null until it has been read. */
  githubAuth: GithubAuth | null;
  /** Whether the AI proxy actually answered. null until a call has been tried —
   *  the settings only say AI is *configured*, never that it is reachable. */
  aiReachable: boolean | null;
  /** Health probe result: ok is green, error is orange, null is gray while
   *  disabled or before the first check lands. */
  aiHealth: "ok" | "error" | null;
  /** Records the outcome of an AI call so the UI can stop claiming it works. */
  noteAiResult: (ok: boolean) => void;
  /** Ping the proxy's /health endpoint and store the outcome. */
  checkAiHealth: () => Promise<void>;
  /** The last review of the open note, or null. Only ever set by `analyze`. */
  analysis: AnalysisResult | null;
  analyzing: boolean;
  /** Review the open note. Explicit: this is the one AI call the user asks for. */
  analyze: () => Promise<void>;
  clearAnalysis: () => void;

  openVault: (path: string) => Promise<void>;
  restoreVault: () => Promise<void>;
  refresh: () => Promise<void>;
  select: (id: string | null) => Promise<void>;
  create: (noteType: NoteType, title: string) => Promise<void>;
  /** Add a prompt to the open collection and open it in the editor. */
  addPrompt: () => Promise<void>;
  /** Reorder a collection's children (drag & drop) and persist the order. */
  reorderChildren: (parentId: string, ordered: string[]) => Promise<void>;
  /** Reorder the top level of a section — buckets and loose notes together. */
  reorderNotes: (ordered: string[]) => Promise<void>;
  /** Move a bubble of the open idea from one index to another. */
  moveBubble: (fromIndex: number, toIndex: number) => void;
  /** A paste landing in the collection view: split it into several prompts, or
   *  add it as a single prompt when it has no structure to split. */
  pasteIntoCollection: (text: string, forceOne?: boolean) => Promise<void>;
  queueSave: (id: string, body: string) => void;
  /** Drop a queued save without writing it.
   *
   *  Needed before replacing the open note's text from underneath the editor:
   *  the pending body predates the replacement, so letting it land would undo
   *  the very thing that was just restored. */
  discardPendingSave: () => void;
  updateModel: (model: string | null) => Promise<void>;
  /** Cycle or set the idea marker for an idea in the sidebar. */
  setNoteMark: (id: string, mark: boolean | IdeaMarkState | string) => Promise<void>;
  /** Assign a model to the bubble whose first line is `key`. */
  setBubbleModel: (key: string, model: string | null) => Promise<void>;
  /** Replace the tags attached to the bubble whose first line is `key`. */
  setBubbleTags: (key: string, tags: string[]) => Promise<void>;
  /** Migrate bubble model and tag keys when a bubble's first line changes. */
  migrateBubbleKeys: (migrations: Array<{ oldKey: string; newKey: string }>) => void;
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
  setSettings: (open: boolean) => void;
  /** Draft a GitHub issue for the bubble whose first line is `label`. */
  openIssueDraft: (label: string) => void;
  closeIssueDraft: () => void;
  /** Record the issue a bubble just became, without waiting for a reload. */
  noteBubbleIssue: (label: string, issue: IssueRef) => void;
  requestConfirm: (message: string, onConfirm: () => void, confirmLabel?: string) => void;
  requestChoice: (request: DialogRequest) => void;
  cancelConfirm: () => void;
  openMenu: (at: {
    x: number;
    y: number;
    hasSelection: boolean;
    link: string | null;
    note: { id: string; title: string; type: NoteType } | null;
    bubble: { label: string; start: number } | null;
  }) => void;
  closeMenu: () => void;
  setLinkPicker: (open: boolean) => void;
  requestLink: (title: string | null) => void;
  /** Ask the editor to wrap the current selection in one bubble. */
  requestMergeSelection: () => void;
  scrollToPos: (pos: number) => void;
  clearScroll: () => void;
  openFind: () => void;
  closeFind: () => void;
  setFindQuery: (query: string) => void;
  findMove: (dir: 1 | -1) => void;
  /** Remove the bubble starting at `start` in the open idea's body. */
  deleteBubbleAt: (start: number) => void;
  setHoverBubble: (label: string | null) => void;
  setCursorBubble: (label: string | null) => void;
  setHoverPrompt: (prompt: ChildPrompt | null) => void;
  holdHoverPrompt: () => void;
  releaseHoverPrompt: () => void;
  setError: (error: string | null) => void;
  setNotice: (notice: string | null) => void;
  /** A notice with one thing to do about it, e.g. undoing a cleanup. */
  setNoticeAction: (notice: string, label: string, run: () => void) => void;
  loadAiSettings: () => Promise<void>;
  loadGithubAuth: () => Promise<void>;
  setGithubAuth: (auth: GithubAuth) => void;
  saveAiSettings: (enabled: boolean) => Promise<void>;
  saveBubbleMetadataVisible: (visible: boolean) => Promise<void>;
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
  settingsOpen: false,
  issueDraft: null,
  menuAt: null,
  linkPickerOpen: false,
  insertLink: null,
  mergeSelection: 0,
  scrollTo: null,
  find: null,
  findFocus: 0,
  findCount: 0,
  hoverBubble: null,
  cursorBubble: null,
  hoverPrompt: null,
  dirty: false,
  error: null,
  notice: null,
  noticeAction: null,
  drafts: null,
  pastedText: "",
  oneBlockPaste: false,
  aiSettings: { enabled: true, showBubbleMetadata: true, configured: true },
  githubAuth: null,
  aiReachable: null,
  aiHealth: null,
  analysis: null,
  analyzing: false,

  analyze: async () => {
    const active = get().active;
    if (!active || get().analyzing) return;
    // Review what is on disk, not a half-typed buffer.
    await get().flushSave();
    set({ analyzing: true, analysis: null });
    try {
      const analysis = await api.analyzeNote(active.id);
      get().noteAiResult(true);
      // The note may have been switched while the request was in flight.
      if (get().active?.id === active.id) set({ analysis });
    } catch (e) {
      get().noteAiResult(false);
      set({ error: message(e) });
    } finally {
      set({ analyzing: false });
    }
  },

  clearAnalysis: () => set({ analysis: null }),

  noteAiResult: (ok) => {
    if (get().aiReachable !== ok) {
      set({ aiReachable: ok });
      if (!ok) {
        set({
          notice: "AI is unreachable right now — tagging is falling back to a local pass.",
        });
      }
    }
    // The status dot reflects the latest signal, successful or not, so a failed
    // call flips it orange even between health checks.
    if (get().aiHealth !== (ok ? "ok" : "error")) {
      set({ aiHealth: ok ? "ok" : "error" });
    }
  },

  checkAiHealth: async () => {
    const ok = await api.aiHealth().catch(() => false);
    if (get().aiHealth !== (ok ? "ok" : "error")) {
      set({ aiHealth: ok ? "ok" : "error" });
    }
  },

  setPalette: (paletteOpen) => set({ paletteOpen, paletteQuery: paletteOpen ? get().paletteQuery : "" }),
  openPalette: (query) => set({ paletteOpen: true, paletteQuery: query }),
  setSettings: (settingsOpen) => set({ settingsOpen }),

  openIssueDraft: (label) => {
    const active = get().active;
    if (!active) return;
    set({ issueDraft: { noteId: active.id, label } });
  },

  closeIssueDraft: () => set({ issueDraft: null }),

  noteBubbleIssue: (label, issue) => {
    const active = get().active;
    if (!active) return;
    set({
      active: {
        ...active,
        bubbleIssues: { ...active.bubbleIssues, [label]: issue.key },
        issueStates: { ...active.issueStates, [label]: issue },
      },
    });
  },
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
  requestMergeSelection: () => set({ mergeSelection: get().mergeSelection + 1 }),
  scrollToPos: (pos) => {
    const active = get().active;
    if (active) set({ scrollTo: { id: active.id, pos } });
  },
  clearScroll: () => set({ scrollTo: null }),
  openFind: () =>
    set((state) => ({
      // Reopening find keeps the current query so the shortcut can focus and
      // select it instead of unexpectedly clearing what the user typed.
      find: state.find ?? { query: "", index: 0, move: false },
      findFocus: state.findFocus + 1,
    })),
  closeFind: () => set({ find: null }),
  // `move: true` so typing scrolls to the first match as you go, the way an
  // incremental find is expected to behave. Enter then advances from there.
  setFindQuery: (query) => set({ find: { query, index: 0, move: true } }),
  deleteBubbleAt: (start) => {
    const active = get().active;
    if (!active || active.type !== "idea") return;
    const body = active.body ?? "";
    if (start < 0 || start >= body.length) return;

    // The bubble runs to the blank line that ends it; take that separator too so
    // deleting does not leave a widening gap. Falls back to the end of the body
    // for the last bubble.
    const rest = body.slice(start);
    const gap = /\n[ \t]*\n/.exec(rest);
    let from = start;
    const to = gap ? start + gap.index + gap[0].length : body.length;
    if (!gap) {
      // Last bubble: take the separator before it instead.
      const before = /\n[ \t]*\n$/.exec(body.slice(0, start));
      if (before) from -= before[0].length;
    }

    const next = body.slice(0, from) + body.slice(to);
    set({
      active: { ...active, body: next },
      docVersion: get().docVersion + 1,
    });
    get().queueSave(active.id, next);
  },

  setHoverBubble: (label) => {
    if (get().hoverBubble !== label) set({ hoverBubble: label });
  },
  setCursorBubble: (label) => {
    if (get().cursorBubble !== label) set({ cursorBubble: label });
  },
  setHoverPrompt: (hoverPrompt) => {
    if (hoverPromptTimer) {
      clearTimeout(hoverPromptTimer);
      hoverPromptTimer = null;
    }
    if (hoverPrompt) {
      if (get().hoverPrompt?.id !== hoverPrompt.id) set({ hoverPrompt });
    } else {
      hoverPromptTimer = setTimeout(() => {
        hoverPromptTimer = null;
        set({ hoverPrompt: null });
      }, HOVER_GRACE_MS);
    }
  },
  holdHoverPrompt: () => {
    if (hoverPromptTimer) {
      clearTimeout(hoverPromptTimer);
      hoverPromptTimer = null;
    }
  },
  releaseHoverPrompt: () => {
    if (hoverPromptTimer) clearTimeout(hoverPromptTimer);
    hoverPromptTimer = setTimeout(() => {
      hoverPromptTimer = null;
      set({ hoverPrompt: null });
    }, HOVER_GRACE_MS);
  },

  findMove: (dir) => {
    const find = get().find;
    const count = get().findCount;
    if (!find || count === 0) return;
    const next = (find.index + dir + count) % count;
    set({ find: { ...find, index: next, move: true } });
  },
  setError: (error) => set({ error }),
  // Clearing the action with the notice keeps a stale "Undo" from surviving
  // onto an unrelated message.
  setNotice: (notice) => set({ notice, noticeAction: null }),
  setNoticeAction: (notice, label, run) => set({ notice, noticeAction: { label, run } }),

  loadAiSettings: async () => {
    try {
      set({ aiSettings: await api.getAiSettings() });
    } catch {
      // AI is optional; a failure here must not block the vault.
    }
  },

  loadGithubAuth: async () => {
    try {
      set({ githubAuth: await api.githubAuth() });
    } catch {
      // GitHub is optional; an unusable credential store must not block the
      // vault. The bubble action stays hidden until this succeeds.
    }
  },

  setGithubAuth: (githubAuth) => set({ githubAuth }),

  saveAiSettings: async (enabled) => {
    try {
      set({ aiSettings: await api.setAiSettings(enabled) });
    } catch (e) {
      set({ error: message(e) });
    }
  },

  saveBubbleMetadataVisible: async (visible) => {
    try {
      set({ aiSettings: await api.setBubbleMetadataVisible(visible) });
    } catch (e) {
      set({ error: message(e) });
    }
  },

  openVault: async (path) => {
    try {
      const resolved = await api.openVault(path);
      // Tagging history is keyed by note id, which only means anything within
      // one vault, and AI settings are stored per vault.
      tagged.clear();
      set({ vaultPath: resolved, active: null, backlinks: [], analysis: null, error: null });
      await get().refresh();
      await get().loadAiSettings();
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
    if (hoverPromptTimer) {
      clearTimeout(hoverPromptTimer);
      hoverPromptTimer = null;
    }
    await get().flushSave();
    if (!id) {
      set({ active: null, backlinks: [], children: [], analysis: null, hoverPrompt: null });
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
        hoverPrompt: null,
        scrollTo: null,
        find: null,
        analysis: null,
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

  reorderNotes: async (ordered) => {
    try {
      await api.reorderNotes(ordered);
      await get().refresh();
    } catch (e) {
      set({ error: message(e) });
    }
  },

  moveBubble: (fromIndex, toIndex) => {
    const active = get().active;
    if (!active || active.type !== "idea") return;
    const body = active.body ?? "";
    const blocks = bubbleRanges(body);
    const n = blocks.length;
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= n || toIndex >= n) {
      return;
    }

    // Keep the separators in their original slots so only the moved bubble's
    // own text changes — the same rule the editor's drag follows.
    const prefix = body.slice(0, blocks[0].from);
    const suffix = body.slice(blocks[n - 1].to);
    const texts = blocks.map((b) => body.slice(b.from, b.to));
    const seps = blocks.map((b, i) => body.slice(b.to, i < n - 1 ? blocks[i + 1].from : b.to));

    const [moved] = texts.splice(fromIndex, 1);
    texts.splice(toIndex, 0, moved);

    const next = prefix + texts.map((text, i) => text + seps[i]).join("") + suffix;
    set({ active: { ...active, body: next }, docVersion: get().docVersion + 1 });
    get().queueSave(active.id, next);
  },

  pasteIntoCollection: async (text, forceOne = false) => {
    const active = get().active;
    if (!active || active.collection) return;
    if (!text.trim()) return;
    try {
      // Ctrl+Shift+V asks for one block: never offer a split, and keep the
      // text exactly as pasted — a single prompt, formatting untouched.
      if (!forceOne) {
        const drafts = await api.splitPreview(text);
        if (drafts.length > 1) {
          set({ drafts, pastedText: text });
          return;
        }
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

  discardPendingSave: () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    pending = null;
    // Queued renames describe the text being discarded, so they go with it.
    pendingMigrations = [];
    set({ dirty: false });
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

  setNoteMark: async (id, mark) => {
    try {
      await api.setNoteMark(id, mark);
      const active = get().active;
      if (active?.id === id) set({ active: { ...active, mark } });
      const notes = get().notes.map((n) => (n.id === id ? { ...n, mark } : n));
      set({ notes });
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

  migrateBubbleKeys: (migrations) => {
    const active = get().active;
    if (!active || migrations.length === 0) return;
    let modelsChanged = false;
    let tagsChanged = false;
    let issuesChanged = false;
    const nextModels = { ...(active.models ?? {}) };
    const nextTags = { ...(active.bubbleTags ?? {}) };
    const nextIssues = { ...(active.bubbleIssues ?? {}) };
    const nextIssueStates = { ...(active.issueStates ?? {}) };

    for (const { oldKey, newKey } of migrations) {
      if (!oldKey || !newKey || oldKey === newKey) continue;
      let moved = false;
      if (Object.prototype.hasOwnProperty.call(nextModels, oldKey)) {
        nextModels[newKey] = nextModels[oldKey];
        delete nextModels[oldKey];
        modelsChanged = true;
        moved = true;
      }
      if (Object.prototype.hasOwnProperty.call(nextTags, oldKey)) {
        nextTags[newKey] = nextTags[oldKey];
        delete nextTags[oldKey];
        tagsChanged = true;
        moved = true;
      }
      if (Object.prototype.hasOwnProperty.call(nextIssues, oldKey)) {
        nextIssues[newKey] = nextIssues[oldKey];
        delete nextIssues[oldKey];
        // The cached open/closed state is keyed the same way, so it has to move
        // with the link or the bubble stops muting until the next sync.
        if (Object.prototype.hasOwnProperty.call(nextIssueStates, oldKey)) {
          nextIssueStates[newKey] = nextIssueStates[oldKey];
          delete nextIssueStates[oldKey];
        }
        issuesChanged = true;
        moved = true;
      }
      // One entry per bubble, not per map: the rename is applied to every map
      // in a single write, so queueing it three times would just repeat it.
      if (moved) pendingMigrations.push({ id: active.id, oldKey, newKey });
    }

    if (modelsChanged || tagsChanged || issuesChanged) {
      set({
        active: {
          ...active,
          models: modelsChanged ? nextModels : active.models,
          bubbleTags: tagsChanged ? nextTags : active.bubbleTags,
          bubbleIssues: issuesChanged ? nextIssues : active.bubbleIssues,
          issueStates: issuesChanged ? nextIssueStates : active.issueStates,
        },
      });
    }
  },

  setBubbleTags: async (key, tags) => {
    const active = get().active;
    if (!active) return;
    try {
      const bubbleTags = await api.setBubbleTags(active.id, key, tags);
      set({ active: { ...active, bubbleTags } });
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

    // Bubble renames ride the same debounce as the text that caused them:
    // remapping on every keystroke of a first line would be one write per
    // character. Done before the body write so the reindex sees final keys.
    const renames = pendingMigrations;
    pendingMigrations = [];
    for (const { id, oldKey, newKey } of renames) {
      try {
        await api.renameBubbleKey(id, oldKey, newKey);
      } catch (e) {
        // A rename that fails leaves the metadata on the old key, which is the
        // pre-existing behaviour rather than a loss. Not worth interrupting a save.
        console.warn("could not move bubble metadata", oldKey, "->", newKey, e);
      }
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
      if (get().aiSettings.enabled && shouldAutoTag(write.id, write.body)) {
        // Recorded before the call, so a burst of saves cannot fire twice.
        tagged.set(write.id, { at: Date.now(), length: write.body.trim().length });
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
   *  note. Unsaved edits keep their text; metadata is refreshed either way. */
  reloadExternal: async () => {
    await get().refresh();

    const active = get().active;
    if (!active) return;

    try {
      const fresh = await api.readNote(active.id);

      // Mid-edit, the text on disk is older than what is on screen, so it must
      // not be taken. The issue states are not the user's to edit and change
      // without them, so those are merged in regardless — otherwise a sync that
      // lands between two keystrokes is simply lost, and a bubble keeps showing
      // a state its issue left minutes ago.
      if (get().dirty) {
        set({ active: { ...active, issueStates: fresh.issueStates } });
        return;
      }

      // Always take the fresh copy: metadata can change with the text
      // untouched — an issue closing is exactly that, and gating the whole
      // note on a text change left the editor showing a stale issue state
      // forever. Only the doc version is gated, because bumping it reloads
      // CodeMirror and moves the cursor.
      const textChanged = fresh.body !== active.body || fresh.title !== active.title;
      set(textChanged ? { active: fresh, docVersion: get().docVersion + 1 } : { active: fresh });
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
