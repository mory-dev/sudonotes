import { invoke } from "@tauri-apps/api/core";

export type NoteType = "prompt" | "idea";

export type IdeaMarkState = "orange" | "green" | "off";

export function normalizeIdeaMark(
  value: boolean | IdeaMarkState | string | null | undefined,
): IdeaMarkState {
  if (value === true || value === "orange" || value === "on") {
    return "orange";
  }
  if (value === "green") {
    return "green";
  }
  return "off";
}

export function nextIdeaMark(
  current: boolean | IdeaMarkState | string | null | undefined,
): IdeaMarkState {
  const normalized = normalizeIdeaMark(current);
  switch (normalized) {
    case "off":
      return "orange";
    case "orange":
      return "green";
    case "green":
      return "off";
  }
}

export interface NoteMeta {
  id: string;
  title: string;
  type: NoteType;
  tags: string[];
  /** Set when the note lives in a collection subfolder. */
  collection: string | null;
  summary: string | null;
  updated: string;
  /** The LLM this prompt is written for, if any. */
  model?: string | null;
  /** Original order within its collection, when the note is a child prompt. */
  position?: number | null;
  /** Project folder a linked idea mirrors into, if any. */
  project?: string | null;
  /** Idea marking state in the sidebar ("orange", "green", "off", or boolean for compatibility). */
  onHold?: boolean | IdeaMarkState | string | null;
  /** Favicon of the linked project, when one was found. */
  icon?: string | null;
  /** Blank-line separated groups in the body. Shown beside an idea's title. */
  bubbles?: number;
}

/** A prompt filed under a collection, shown inline on the collection's page. */
export interface ChildPrompt {
  id: string;
  title: string;
  body: string;
  tags: string[];
  model: string | null;
  position: number | null;
}

/** A prompt detected inside pasted text, before the user confirms it. */
export interface DraftPrompt {
  title: string;
  body: string;
  summary: string;
  tags: string[];
}

export interface NoteDetail extends NoteMeta {
  model: string | null;
  position: number | null;
  project: string | null;
  /** Per-bubble model assignment for idea notes: bubble first line -> model. */
  models: Record<string, string>;
  /** Per-bubble tags for idea notes: bubble first line -> tags. */
  bubbleTags: Record<string, string[]>;
  created: string;
  body: string;
  path: string;
}

export interface ProjectInfo {
  path: string;
  name: string;
  exists: boolean;
  isGitRepo: boolean;
  /** Favicon found in the project, as a data: URI. */
  icon: string | null;
}

export interface LinkResult {
  info: ProjectInfo;
  /** The project already has the target IDEAS.md and nothing was written. */
  conflict: boolean;
}

export interface ModelInfo {
  id: string;
  provider: string;
  model: string;
  name: string;
  context: number | null;
  output: number | null;
  reasoning: boolean;
  vision: boolean;
  tools: boolean;
}

export interface ModelCatalog {
  models: ModelInfo[];
  fetchedAt: number;
}

export interface AiSettings {
  enabled: boolean;
  /** Whether tags and model assignments appear below idea bubbles. */
  showBubbleMetadata: boolean;
  /** The proxy is available by default; the provider key lives on the server. */
  configured: boolean;
}

/** A review of one note against the model it targets. */
export interface AnalysisResult {
  fit: "excellent" | "good" | "uncertain" | "poor" | "not_applicable";
  fitReason: string;
  issues: string[];
  refinements: string[];
  refinedText: string | null;
  suggestedTags: string[];
  /** Model IDs that might suit the prompt better. */
  alternatives: string[];
}

/** One vault snapshot on disk. */
export interface BackupInfo {
  path: string;
  created: string;
  bytes: number;
  /** Only known for a backup this session wrote; 0 when listed from disk. */
  notes: number;
}

export interface BackupSettings {
  enabled: boolean;
  /** How many archives to keep before the oldest is rotated away. */
  keep: number;
  /** Minimum minutes between automatic snapshots. */
  intervalMinutes: number;
  /** Where archives are written — outside the vault, so it can be shown. */
  directory: string;
  last: BackupInfo | null;
}

export interface SearchBubble {
  /** First line that identifies this idea bubble. */
  label: string;
  /** UTF-16 editor offset used to jump to the matching bubble. */
  start: number;
}

export interface SearchHit {
  id: string;
  title: string;
  type: NoteType;
  snippet: string;
  /** Set for a result produced by per-bubble model/tag metadata. */
  bubble?: SearchBubble | null;
  /** Model assignment that matched the query, when applicable. */
  model?: string | null;
  /** Tags that matched a tag-only query (or a metadata search). */
  tags?: string[];
}

export interface PathInfo {
  exists: boolean;
  noteCount: number;
}

/** Thin typed wrappers over the Rust commands — the only place command names are spelled. */
export const api = {
  openVault: (path: string) => invoke<string>("open_vault", { path }),
  lastVault: () => invoke<string | null>("last_vault"),
  getAiSettings: () => invoke<AiSettings>("get_ai_settings"),
  setAiSettings: (enabled: boolean) => invoke<AiSettings>("set_ai_settings", { enabled }),
  setBubbleMetadataVisible: (visible: boolean) =>
    invoke<AiSettings>("set_bubble_metadata_visible", { visible }),
  /** Whether the AI proxy answers its health endpoint. */
  aiHealth: () => invoke<boolean>("ai_health"),
  appVersion: () => invoke<string>("app_version"),
  modelCatalog: (force = false) => invoke<ModelCatalog>("model_catalog", { force }),
  autoTagNote: (id: string) => invoke<string[]>("auto_tag_note", { id }),
  /** A full review of a note. Explicit — never fired automatically. */
  analyzeNote: (id: string) => invoke<AnalysisResult>("analyze_note", { id }),
  /** A brief LLM title for content; empty when no model is configured. */
  suggestTitle: (content: string) => invoke<string>("suggest_title", { content }),
  suggestVaultPath: () => invoke<string>("suggest_vault_path"),
  inspectPath: (path: string) => invoke<PathInfo>("inspect_path", { path }),
  listNotes: (noteType?: NoteType) =>
    invoke<NoteMeta[]>("list_notes", { noteType: noteType ?? null }),
  readNote: (id: string) => invoke<NoteDetail>("read_note", { id }),
  createNote: (noteType: NoteType, title: string) =>
    invoke<string>("create_note", { noteType, title }),
  /** Add a prompt into the open collection, returning its id. */
  createChild: (parentId: string, title: string, body: string) =>
    invoke<string>("create_child", { parentId, title, body }),
  /** Apply a new order to a collection's children, rewriting their positions. */
  reorderChildren: (parentId: string, ordered: string[]) =>
    invoke<void>("reorder_children", { parentId, ordered }),
  /** Apply a new order to the top level of a section. A collection is ordered
   *  by its own parent note, so buckets and loose notes share one list. */
  reorderNotes: (ordered: string[]) => invoke<void>("reorder_notes", { ordered }),
  backupState: () => invoke<BackupSettings>("backup_state"),
  setBackupEnabled: (enabled: boolean) =>
    invoke<BackupSettings>("set_backup_enabled", { enabled }),
  /** Adjust how many archives are kept and how often one is written. */
  setBackupRetention: (keep: number, intervalMinutes: number) =>
    invoke<BackupSettings>("set_backup_retention", { keep, intervalMinutes }),
  /** Snapshot the open vault now, whatever the schedule says. */
  backupNow: () => invoke<BackupInfo>("backup_now"),
  /** Unpack a .bak over a folder (existing notes are replaced, after being
   *  saved to the backup directory first), returning how many notes came back. */
  restoreBackup: (archive: string, destination: string) =>
    invoke<number>("restore_backup", { archive, destination }),
  writeNote: (id: string, body: string) => invoke<void>("write_note", { id, body }),
  updateModel: (id: string, model: string | null) =>
    invoke<void>("update_model", { id, model }),
  /** Set or cycle the marking state shown beside an idea. */
  setNoteOnHold: (id: string, onHold: boolean | IdeaMarkState | string) =>
    invoke<void>("set_note_on_hold", { id, onHold }),
  /** Assign the model a bubble's prompt targets, keyed by its first line. */
  setBubbleModel: (id: string, key: string, model: string) =>
    invoke<Record<string, string>>("set_bubble_model", { id, key, model }),
  /** Replace the tags attached to an idea bubble, keyed by its first line. */
  setBubbleTags: (id: string, key: string, tags: string[]) =>
    invoke<Record<string, string[]>>("set_bubble_tags", { id, key, tags }),
  renameNote: (id: string, title: string) => invoke<void>("rename_note", { id, title }),
  updateNote: (
    id: string,
    title: string,
    body: string,
    tags: string[],
    model: string | null,
  ) => invoke<void>("update_note", { id, title, body, tags, model }),
  deleteNote: (id: string) => invoke<void>("delete_note", { id }),
  search: (query: string, limit = 50) => invoke<SearchHit[]>("search", { query, limit }),
  backlinks: (id: string) => invoke<NoteMeta[]>("backlinks", { id }),
  collectionChildren: (id: string) => invoke<ChildPrompt[]>("collection_children", { id }),
  linkProject: (id: string, path: string, force: boolean) =>
    invoke<LinkResult>("link_project", { id, path, force }),
  /** Use a project's existing IDEAS.md as the note's baseline, then link it. */
  importProjectIdea: (id: string, path: string) =>
    invoke<ProjectInfo>("import_project_idea", { id, path }),
  unlinkProject: (id: string, removeFile: boolean) =>
    invoke<void>("unlink_project", { id, removeFile }),
  projectInfo: (path: string) => invoke<ProjectInfo>("project_info", { path }),
  splitPreview: (text: string) => invoke<DraftPrompt[]>("split_preview", { text }),
  applySplit: (id: string, drafts: DraftPrompt[], paste: string) =>
    invoke<number>("apply_split", { id, drafts, paste }),
  resolveLink: (title: string) => invoke<string | null>("resolve_link", { title }),
};
