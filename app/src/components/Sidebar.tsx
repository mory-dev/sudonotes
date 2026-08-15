import { useMemo, useState } from "react";

import type { NoteMeta, NoteType } from "../api";
import { useStore } from "../store";
import { useListDrag, reordered, type NoteDragHandlers } from "../useListDrag";
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
        data-drag-key={drag?.["data-drag-key"]}
        data-drag-list={drag?.["data-drag-list"]}
        data-tooltip={`${note.summary ?? note.title}\nDrag to reorder · Middle-click to delete`}
        onClick={() => void select(note.id)}
        onAuxClick={onAuxClick}
        onPointerDown={drag?.onPointerDown}
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
  drag,
}: {
  name: string;
  notes: NoteMeta[];
  parent?: NoteMeta;
  /** Reorders the bucket among its siblings; the children have their own. */
  drag?: NoteDragHandlers;
}) {
  const activeId = useStore((s) => s.active?.id ?? null);
  const select = useStore((s) => s.select);

  const [open, setOpen] = useState(() => notes.some((n) => n.id === activeId));

  const childDrag = useListDrag(`bucket:${name}`, (fromId, toId) => {
    if (!parent) return;
    const next = reordered(
      notes.map((n) => n.id),
      fromId,
      toId,
    );
    if (next) void useStore.getState().reorderChildren(parent.id, next);
  });

  const isParentActive = parent?.id === activeId;

  // A single click selects the collection's note; only a double click opens or
  // closes the list. Toggling on the first click meant every visit to the
  // collection's own note also collapsed the children the user was reading.
  const onClick = () => {
    if (parent) void select(parent.id);
  };

  const onDoubleClick = () => setOpen((v) => !v);

  const headClasses = [
    isParentActive ? "collection-head active" : "collection-head",
    drag?.isOver ? "drop-target" : "",
    drag?.isDragging ? "dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className="collection" data-type={parent?.type ?? notes[0]?.type ?? "prompt"}>
      <div className={headClasses}>
        <button
          className="collection-open"
          data-drag-key={drag?.["data-drag-key"]}
          data-drag-list={drag?.["data-drag-list"]}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onPointerDown={drag?.onPointerDown}
          aria-expanded={open}
          data-tooltip={`${name}\nDouble-click to ${open ? "collapse" : "expand"} · Drag to reorder`}
        >
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
                ...childDrag.rowProps(note.id),
                isDragging: childDrag.dragKey === note.id,
                isOver: childDrag.overKey === note.id && childDrag.dragKey !== note.id,
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
  //
  // Buckets and loose notes then share one ordered list, so a drag can move a
  // bucket past a note and back. A bucket is ordered by its own parent note,
  // which is what carries the position on disk.
  const entries = useMemo(() => {
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

    type Entry =
      | { kind: "collection"; key: string; name: string; items: NoteMeta[]; parent?: NoteMeta }
      | { kind: "note"; key: string; note: NoteMeta };

    const list: { entry: Entry; position: number | null; label: string }[] = [];

    for (const [name, items] of grouped) {
      const parent = owners.get(name);
      list.push({
        entry: { kind: "collection", key: parent?.id ?? `collection:${name}`, name, items, parent },
        position: parent?.position ?? null,
        label: name,
      });
    }
    for (const note of topLevel) {
      if (owners.has(note.title)) continue;
      list.push({
        entry: { kind: "note", key: note.id, note },
        position: note.position ?? null,
        label: note.title,
      });
    }

    // Anything never dragged has no position yet, and sorts by name after the
    // rows that do — so an explicit order is stable and the rest stay alphabetical.
    list.sort((a, b) => {
      const pa = a.position ?? Number.MAX_SAFE_INTEGER;
      const pb = b.position ?? Number.MAX_SAFE_INTEGER;
      return pa - pb || a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    });

    return list.map((item) => item.entry);
  }, [notes]);

  const reorderNotes = useStore((s) => s.reorderNotes);

  const drag = useListDrag(`section:${noteType}`, (fromKey, toKey) => {
    const keys = entries.map((e) => e.key);
    const next = reordered(keys, fromKey, toKey);
    // A bucket with no note of its own has no frontmatter to write a position
    // into, so it cannot take part in an explicit order.
    if (next && !next.some((key) => key.startsWith("collection:"))) {
      void reorderNotes(next);
    }
  });

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
          {entries.map((entry) =>
            entry.kind === "collection" ? (
              <Collection
                key={entry.key}
                name={entry.name}
                notes={entry.items}
                parent={entry.parent}
                drag={{
                  ...drag.rowProps(entry.key),
                  isDragging: drag.dragKey === entry.key,
                  isOver: drag.overKey === entry.key && drag.dragKey !== entry.key,
                }}
              />
            ) : (
              <NoteRow
                key={entry.key}
                note={entry.note}
                drag={{
                  ...drag.rowProps(entry.key),
                  isDragging: drag.dragKey === entry.key,
                  isOver: drag.overKey === entry.key && drag.dragKey !== entry.key,
                }}
              />
            ),
          )}
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
  const moveBubble = useStore((s) => s.moveBubble);

  // Outline rows are keyed by index: a bubble has no id, and its position in
  // the body is exactly what the drag is changing.
  const outlineDrag = useListDrag("idea-outline", (fromKey, toKey) => {
    moveBubble(Number(fromKey), Number(toKey));
  });

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
              {ideaOutline.map((item, index) => {
                const key = String(index);
                const rows = outlineDrag.rowProps(key);
                const classes = [
                  "idea-outline-item",
                  outlineDrag.overKey === key && outlineDrag.dragKey !== key ? "drop-target" : "",
                  outlineDrag.dragKey === key ? "dragging" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <li key={index}>
                    <button
                      className={classes}
                      data-drag-key={rows["data-drag-key"]}
                      data-drag-list={rows["data-drag-list"]}
                      data-tooltip={`${item.label}
Drag to reorder · Right-click to delete this bubble`}
                      onClick={() => scrollToPos(item.start)}
                      onPointerDown={rows.onPointerDown}
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
                );
              })}
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
