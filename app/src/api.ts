import { invoke } from "@tauri-apps/api/core";

export type NoteType = "prompt" | "idea";

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
  /** Favicon of the linked project, when one was found. */
  icon?: string | null;
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
  /** The proxy is available by default; the provider key lives on the server. */
  configured: boolean;
}

export interface SearchHit {
  id: string;
  title: string;
  type: NoteType;
  snippet: string;
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
  modelCatalog: (force = false) => invoke<ModelCatalog>("model_catalog", { force }),
  autoTagNote: (id: string) => invoke<string[]>("auto_tag_note", { id }),
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
  writeNote: (id: string, body: string) => invoke<void>("write_note", { id, body }),
  updateModel: (id: string, model: string | null) =>
    invoke<void>("update_model", { id, model }),
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
