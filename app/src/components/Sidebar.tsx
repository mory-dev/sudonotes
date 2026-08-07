import { useMemo, useState } from "react";

import type { NoteMeta, NoteType } from "../api";
import { useStore } from "../store";
import { ModelStack } from "./ModelStack";
import { IdeaMark, PromptMark } from "./NoteMarks";
import { ProviderIcon, providerOf } from "./ProviderMarks";

function byTitle(a: NoteMeta, b: NoteMeta) {
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

/** Collection children follow their saved order (position), then title. */
function byPosition(a: NoteMeta, b: NoteMeta) {
  const pa = a.position ?? Number.MAX_SAFE_INTEGER;
  const pb = b.position ?? Number.MAX_SAFE_INTEGER;
  return pa - pb || byTitle(a, b);
}

interface NoteDragHandlers {
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: (fromId: string) => void;
  isDragging: boolean;
  isOver: boolean;
}

/** The initial letter of a project folder's name, for the placeholder. */
function projectInitial(project: string | null | undefined): string {
  const name = project?.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  return (name.charAt(0) || "?").toUpperCase();
}

/** The bubbles of an idea note: each paragraph (and the list that follows it)
 *  with the body position its first line starts at. */
function paragraphOutline(body: string): { start: number; label: string }[] {
  const out: { start: number; label: string }[] = [];
  const lines = body.split("\n");
  let offset = 0;
  let buffer: string[] = [];
  let groupStart = 0;
  for (const line of lines) {
    if (line.trim() === "") {
      if (buffer.length > 0) {
        out.push({ start: groupStart, label: buffer[0].trim() });
        buffer = [];
      }
    } else {
      if (buffer.length === 0) groupStart = offset;
      buffer.push(line);
    }
    offset += line.length + 1;
  }
  if (buffer.length > 0) out.push({ start: groupStart, label: buffer[0].trim() });
  return out;
}

function NoteRow({ note, drag }: { note: NoteMeta; drag?: NoteDragHandlers }) {
  const activeId = useStore((s) => s.active?.id ?? null);
  const select = useStore((s) => s.select);
  const remove = useStore((s) => s.remove);
  const requestConfirm = useStore((s) => s.requestConfirm);

  const onAuxClick = (event: React.MouseEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();
    requestConfirm(
      `Delete "${note.title}"? This cannot be undone.`,
      () => void remove(note.id),
      "Delete",
    );
  };

  const classes = [
    note.id === activeId ? "note-item active" : "note-item",
    drag?.isOver ? "drop-target" : "",
    drag?.isDragging ? "dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li data-type={note.type}>
      <button
        className={classes}
        draggable={!!drag}
        data-tooltip={`${note.summary ?? note.title}\nMiddle-click to delete`}
        onClick={() => void select(note.id)}
        onAuxClick={onAuxClick}
        onDragStart={(event) => {
          if (!drag) return;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", note.id);
          drag.onDragStart();
        }}
        onDragOver={(event) => {
          if (!drag) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          drag.onDragOver();
        }}
        onDrop={(event) => {
          if (!drag) return;
          event.preventDefault();
          drag.onDrop(event.dataTransfer.getData("text/plain") ?? "");
        }}
      >
        {note.project ? (
          note.icon ? (
            <img className="note-project-icon" src={note.icon} alt="" data-tooltip={note.project} />
          ) : (
            <span className="note-project-icon placeholder" data-tooltip={note.project}>
              {projectInitial(note.project)}
            </span>
          )
        ) : note.type === "idea" ? (
          // Ideas mix linked and unlinked, so an unlinked one still needs the
          // slot filled or its title steps left out of the column. A gray leaf
          // reads as a draft that has not been pointed at a project yet.
          <span className="note-project-icon unlinked" data-tooltip="No project linked">
            <IdeaMark />
          </span>
        ) : null}
        {/* The model icon stays on prompts; an idea's models belong to its
            bubbles, shown as a badge on the bubble in the editor instead. */}
        {note.type === "prompt" && note.model ? (
          <ProviderIcon provider={providerOf(note.model)} size={13} />
        ) : null}
        <span className="note-title">{note.title}</span>
        {note.type === "idea" && (note.bubbles ?? 0) > 0 && (
          <span className="count">{note.bubbles}</span>
        )}
      </button>
    </li>
  );
}

/** A subfolder of prompts/ or ideas/, holding prompts split out of one paste.
 *  The header is the collection's own note, so it is not listed twice. */
function Collection({
  name,
  notes,
  parent,
}: {
  name: string;
  notes: NoteMeta[];
  parent?: NoteMeta;
}) {
  const activeId = useStore((s) => s.active?.id ?? null);
  const select = useStore((s) => s.select);

  const [open, setOpen] = useState(() => notes.some((n) => n.id === activeId));
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const isParentActive = parent?.id === activeId;

  // One target: opens the collection's own note and toggles the list with it.
  const onClick = () => {
    setOpen((v) => !v);
    if (parent) void select(parent.id);
  };

  const onDrop = (fromId: string, targetId: string) => {
    setDragId(null);
    setOverId(null);
    if (!fromId || fromId === targetId || !parent) return;
    const ids = notes.map((n) => n.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, fromId);
    void useStore.getState().reorderChildren(parent.id, ids);
  };

  return (
    <li className="collection" data-type={parent?.type ?? notes[0]?.type ?? "prompt"}>
      <div className={isParentActive ? "collection-head active" : "collection-head"}>
        <button className="collection-open" onClick={onClick} aria-expanded={open}>
          <span className="collection-name">{name}</span>
        </button>
        <ModelStack notes={notes} />
        <span className="count">{notes.length}</span>
      </div>
      {open && (
        <ul className="note-list nested">
          {notes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              drag={{
                onDragStart: () => setDragId(note.id),
                onDragOver: () => setOverId(note.id),
                onDrop: (fromId) => onDrop(fromId, note.id),
                isDragging: dragId === note.id,
                isOver: overId === note.id && dragId !== note.id,
              }}
            />
          ))}
        </ul>
      )}
    </li>
  );
}


function Section({
  label,
  noteType,
  notes,
}: {
  label: string;
  noteType: NoteType;
  notes: NoteMeta[];
}) {
  const create = useStore((s) => s.create);

  // Notes in a subfolder are grouped under it; the rest stay top level. A note
  // whose title matches a collection owns it, and becomes the group's header
  // rather than a second row of its own.
  const { collections, loose } = useMemo(() => {
    const grouped = new Map<string, NoteMeta[]>();
    const topLevel: NoteMeta[] = [];

    for (const note of notes) {
      if (note.collection) {
        const bucket = grouped.get(note.collection) ?? [];
        bucket.push(note);
        grouped.set(note.collection, bucket);
      } else {
        topLevel.push(note);
      }
    }

    for (const bucket of grouped.values()) bucket.sort(byPosition);

    const owners = new Map<string, NoteMeta>();
    for (const note of topLevel) {
      if (grouped.has(note.title)) owners.set(note.title, note);
    }

    return {
      collections: [...grouped.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, items]) => ({ name, items, parent: owners.get(name) })),
      loose: topLevel.filter((n) => !owners.has(n.title)).sort(byTitle),
    };
  }, [notes]);

  return (
    <section className="section" data-type={noteType}>
      <header className="section-header">
        <span className="section-name">
          <span className="section-mark">
            {noteType === "prompt" ? <PromptMark /> : <IdeaMark />}
          </span>
          {label} <span className="count">{notes.length}</span>
        </span>
        <button
          className="icon-button"
          data-tooltip={`New ${noteType}`}
          onClick={() => void create(noteType, "")}
        >
          +
        </button>
      </header>

      {notes.length === 0 ? (
        <div className="empty-note">
          <span className="empty-mark">
            {noteType === "prompt" ? <PromptMark /> : <IdeaMark />}
          </span>
          <p>
            {noteType === "prompt"
              ? "Organize, link, and refine the prompts you keep rewriting."
              : "Brainstorm and sketch ideas, then link them to a project."}
          </p>
          <button className="empty-create" onClick={() => void create(noteType, "")}>
            New {label.toLowerCase()} <kbd>Ctrl N</kbd>
          </button>
        </div>
      ) : (
        <ul className="note-list">
          {collections.map((group) => (
            <Collection
              key={group.name}
              name={group.name}
              notes={group.items}
              parent={group.parent}
            />
          ))}
          {loose.map((note) => (
            <NoteRow key={note.id} note={note} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function Sidebar() {
  const notes = useStore((s) => s.notes);
  const active = useStore((s) => s.active);
  const vaultPath = useStore((s) => s.vaultPath);
  const setPalette = useStore((s) => s.setPalette);
  const scrollToPos = useStore((s) => s.scrollToPos);

  const { prompts, ideas } = useMemo(
    () => ({
      prompts: notes.filter((n) => n.type === "prompt"),
      ideas: notes.filter((n) => n.type === "idea"),
    }),
    [notes],
  );

  const deleteBubbleAt = useStore((s) => s.deleteBubbleAt);
  const requestConfirm = useStore((s) => s.requestConfirm);

  // The bubbles of the open idea, listed so each idea inside it can be jumped to.
  const ideaOutline = useMemo(
    () => (active?.type === "idea" ? paragraphOutline(active.body ?? "") : []),
    [active?.type, active?.body],
  );

  return (
    <aside className="sidebar">
      <button className="search-button" onClick={() => setPalette(true)}>
        <span>Search</span>
        <kbd>Ctrl K</kbd>
      </button>

      <div className="sections">
        <Section label="Prompts" noteType="prompt" notes={prompts} />
        <Section label="Ideas" noteType="idea" notes={ideas} />

        {active?.type === "idea" && ideaOutline.length > 1 && (
          <div className="idea-outline">
            <header className="section-header">
              <span>
                In this idea <span className="count">{ideaOutline.length}</span>
              </span>
            </header>
            <ul>
              {ideaOutline.map((item, index) => (
                <li key={index}>
                  <button
                    className="idea-outline-item"
                    data-tooltip={`${item.label}
Right-click to delete this bubble`}
                    onClick={() => scrollToPos(item.start)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      requestConfirm(
                        `Delete the bubble "${item.label}"?`,
                        () => deleteBubbleAt(item.start),
                        "Delete",
                      );
                    }}
                  >
                    <span className="idea-outline-mark">{index + 1}</span>
                    <span className="idea-outline-label">{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <footer className="vault-path" data-tooltip={vaultPath ?? ""}>
        <svg className="vault-shield" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 1.5 13.5 3.5v4c0 3.4-2.3 5.9-5.5 7-3.2-1.1-5.5-3.6-5.5-7v-4Z" />
          <path d="M5.5 8l1.7 1.7 3.3-3.4" />
        </svg>
        <span className="vault-path-text">{vaultPath}</span>
      </footer>
    </aside>
  );
}
