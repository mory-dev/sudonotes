import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { api, type ChildPrompt } from "../api";
import { useStore } from "../store";
import { useListDrag, reordered, type NoteDragHandlers } from "../useListDrag";
import { ModelPicker } from "./ModelPicker";
import { ProviderIcon, providerOf, shortModelName } from "./ProviderMarks";
import { TagChip } from "./TagChip";
import { TagInput } from "./TagInput";

function HighlightMatches({ text, query }: { text: string; query: string }) {
  if (!query || !query.trim()) return <>{text}</>;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  let last = 0;
  let key = 0;
  let idx = lower.indexOf(needle, last);
  while (idx !== -1) {
    if (idx > last) parts.push(text.slice(last, idx));
    parts.push(
      <mark key={key++} className="cm-find-match">
        {text.slice(idx, idx + needle.length)}
      </mark>,
    );
    last = idx + needle.length;
    idx = lower.indexOf(needle, last);
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/** Render `[[Target]]` (and `[[Target|alias]]`) as clickable links, everything
 *  else as plain text. Newlines are preserved by the caller's white-space. */
function Wikilinks({ text, query }: { text: string; query?: string }) {
  const openLink = useStore((s) => s.openLink);
  const notes = useStore((s) => s.notes);

  const parts: ReactNode[] = [];
  const re = /\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g;
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) {
      const slice = text.slice(last, match.index);
      parts.push(query ? <HighlightMatches key={key++} text={slice} query={query} /> : slice);
    }
    const target = match[1].trim();
    const alias = match[2]?.trim();
    const labelText = alias || target;
    const targetNote = notes.find((n) => n.title.toLowerCase() === target.toLowerCase());

    parts.push(
      <button
        key={key++}
        className="wiki-link"
        data-target={target}
        data-tooltip={`Open "${target}"`}
        onClick={() => void openLink(target)}
      >
        {targetNote?.project ? (
          targetNote.icon ? (
            <img className="note-project-icon" src={targetNote.icon} alt="" data-tooltip={targetNote.project} />
          ) : (
            <span className="note-project-icon placeholder" data-tooltip={targetNote.project}>
              {(targetNote.project.replace(/[\\/]+$/, "").split(/[\\/]/).pop()?.charAt(0) || "?").toUpperCase()}
            </span>
          )
        ) : null}
        {query ? <HighlightMatches text={labelText} query={query} /> : labelText}
      </button>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    const slice = text.slice(last);
    parts.push(query ? <HighlightMatches key={key++} text={slice} query={query} /> : slice);
  }

  return parts.length > 0 ? <>{parts}</> : null;
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <button className="card-copy" onClick={() => void copy()} data-tooltip="Copy prompt">
      {copied ? (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 8.5 6.5 12 13 4.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M5.5 5.5h8v9h-8z" />
          <path d="M10.5 5.5v-4h-8v9h3" />
        </svg>
      )}
      {copied ? "Copied" : label}
    </button>
  );
}

/** Rendered view of one prompt; double-click turns it into a form. */
function Card({
  prompt,
  drag,
  query,
  isCurrentMatch,
}: {
  prompt: ChildPrompt;
  drag?: NoteDragHandlers;
  query?: string;
  isCurrentMatch?: boolean;
}) {
  const select = useStore((s) => s.select);
  const refresh = useStore((s) => s.refresh);
  const setError = useStore((s) => s.setError);
  const aiEnabled = useStore((s) => s.aiSettings.enabled);
  const allNotes = useStore((s) => s.notes);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(prompt.title);
  const [body, setBody] = useState(prompt.body);
  const [tags, setTags] = useState<string[]>(prompt.tags);
  const [model, setModel] = useState(prompt.model ?? "");

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const recentWrapPosition = useRef<{ position: number; until: number } | null>(null);

  // Existing tags across the vault, offered as autocomplete suggestions.
  const tagSuggestions = useMemo(() => {
    const seen = new Set<string>();
    for (const note of allNotes) {
      for (const tag of note.tags) {
        if (!seen.has(tag)) seen.add(tag);
      }
    }
    return [...seen].sort();
  }, [allNotes]);

  // Reset the form whenever the underlying prompt changes.
  useEffect(() => {
    setTitle(prompt.title);
    setBody(prompt.body);
    setTags(prompt.tags);
    setModel(prompt.model ?? "");
  }, [prompt.id, prompt.title, prompt.body, prompt.model, prompt.tags]);

  // Grow the textarea to fit instead of scrolling inside itself.
  useEffect(() => {
    const el = bodyRef.current;
    if (!editing || !el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing, body]);

  const cancel = () => {
    setTitle(prompt.title);
    setBody(prompt.body);
    setTags(prompt.tags);
    setModel(prompt.model ?? "");
    setEditing(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.updateNote(prompt.id, title, body, tags, model.trim() || null);
      setEditing(false);
      await refresh();
      if (aiEnabled) {
        void api.autoTagNote(prompt.id).then(() => refresh()).catch(() => {});
      }
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    const classes = [
      "card",
      drag?.isOver ? "drop-target" : "",
      drag?.isDragging ? "dragging" : "",
      isCurrentMatch ? "current-find-card" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <li
        id={`prompt-card-${prompt.id}`}
        className={classes}
        data-drag-key={drag?.["data-drag-key"]}
        data-drag-list={drag?.["data-drag-list"]}
        onDoubleClick={() => setEditing(true)}
        onMouseEnter={() => useStore.getState().setHoverPrompt(prompt)}
        onMouseLeave={() => {
          if (useStore.getState().hoverPrompt?.id === prompt.id) {
            useStore.getState().setHoverPrompt(null);
          }
        }}
        data-tooltip="Double-click to edit · Drag index to reorder"
      >
        <header className="card-head">
          <span
            className="card-index"
            data-drag-key={drag?.["data-drag-key"]}
            data-drag-list={drag?.["data-drag-list"]}
            data-tooltip="Drag to reorder"
            onPointerDown={drag?.onPointerDown}
          >
            {prompt.position != null ? prompt.position : "•"}
          </span>
          <button
            className="card-title"
            data-tooltip="Open this prompt"
            onClick={() => void select(prompt.id)}
          >
            <HighlightMatches text={prompt.title} query={query ?? ""} />
          </button>
          <CopyButton text={prompt.body} />
        </header>

        <pre className="card-body">
          <Wikilinks text={prompt.body} query={query} />
        </pre>

        {(prompt.tags.length > 0 || prompt.model) && (
          <ul className="card-tags">
            {prompt.model && (
              <li className="is-model">
                <ProviderIcon provider={providerOf(prompt.model)} size={11} />
                {shortModelName(prompt.model, providerOf(prompt.model))}
              </li>
            )}
            {prompt.tags.map((tag) => (
              <li key={tag}>
                <TagChip tag={tag} onClick={() => useStore.getState().openPalette(tag)} />
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li
      id={`prompt-card-${prompt.id}`}
      className="card editing"
      onMouseEnter={() => useStore.getState().setHoverPrompt(prompt)}
      onMouseLeave={() => {
        if (useStore.getState().hoverPrompt?.id === prompt.id) {
          useStore.getState().setHoverPrompt(null);
        }
      }}
    >
      <header className="card-head">
        {prompt.position != null && <span className="card-index">{prompt.position}</span>}
        <input
          className="card-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Prompt title"
          autoFocus
        />
      </header>

      <textarea
        ref={bodyRef}
        className="card-body-input"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "[" && e.currentTarget.selectionStart === e.currentTarget.selectionEnd) {
            if (
              recentWrapPosition.current?.position === e.currentTarget.selectionStart &&
              recentWrapPosition.current.until > Date.now()
            ) {
              recentWrapPosition.current = null;
              e.preventDefault();
              return;
            }
          }
          if (e.key === "[" && e.currentTarget.selectionStart !== e.currentTarget.selectionEnd) {
            e.preventDefault();
            const start = e.currentTarget.selectionStart;
            const end = e.currentTarget.selectionEnd;
            const selected = body.slice(start, end);
            const inserted = `[[${selected}]]`;
            setBody(`${body.slice(0, start)}${inserted}${body.slice(end)}`);
            recentWrapPosition.current = {
              position: start + inserted.length,
              until: Date.now() + 350,
            };
            requestAnimationFrame(() => {
              bodyRef.current?.setSelectionRange(start + inserted.length, start + inserted.length);
            });
            return;
          }
          if (e.key === "Escape") cancel();
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void save();
        }}
        placeholder="Prompt text"
      />

      <div className="card-fields">
        <label>
          <span>Tags</span>
          <TagInput value={tags} onChange={setTags} suggestions={tagSuggestions} />
        </label>
        <label>
          <span>Model</span>
          <ModelPicker value={model} onChange={setModel} />
        </label>
      </div>

      <div className="card-actions">
        <span className="card-hint">Ctrl+Enter saves · Esc cancels</span>
        <button className="secondary" onClick={cancel} disabled={saving}>
          Cancel
        </button>
        <button className="primary" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </li>
  );
}

/** The prompts belonging to a collection — the whole page for a collection note.
 *  Shows the parent's index links, and accepts pasted batches to split. */
export function PromptCards() {
  const active = useStore((s) => s.active);
  const children = useStore((s) => s.children);
  const type = useStore((s) => s.active?.type);
  const addPrompt = useStore((s) => s.addPrompt);
  const reorderChildren = useStore((s) => s.reorderChildren);
  const find = useStore((s) => s.find);
  const findCount = useStore((s) => s.findCount);
  const closeFind = useStore((s) => s.closeFind);
  const setFindQuery = useStore((s) => s.setFindQuery);
  const findMove = useStore((s) => s.findMove);

  const cardDrag = useListDrag(
    `collection-cards:${active?.id ?? "active"}`,
    (fromId, toId) => {
      if (!active) return;
      const next = reordered(
        children.map((c) => c.id),
        fromId,
        toId,
      );
      if (next) void reorderChildren(active.id, next);
    },
  );

  const matchingPromptIds = useMemo(() => {
    if (!find?.query?.trim()) return [];
    const q = find.query.toLowerCase();
    return children
      .filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.body.toLowerCase().includes(q) ||
          c.tags.some((t) => t.toLowerCase().includes(q)),
      )
      .map((c) => c.id);
  }, [children, find?.query]);

  useEffect(() => {
    if (find?.query?.trim()) {
      useStore.setState({ findCount: matchingPromptIds.length });
    } else if (find) {
      useStore.setState({ findCount: 0 });
    }
  }, [find?.query, matchingPromptIds.length]);

  useEffect(() => {
    if (!find || matchingPromptIds.length === 0) return;
    const index = Math.max(0, Math.min(find.index, matchingPromptIds.length - 1));
    const targetId = matchingPromptIds[index];
    if (targetId) {
      const el = document.getElementById(`prompt-card-${targetId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [find?.index, find?.move, matchingPromptIds]);

  // Pasting a batch into a collection offers to split it into prompts, exactly
  // as the editor does for a single note. A single prompt lands directly.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea")) return;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!text.trim()) return;
      // Ctrl+Shift+V asks for one block: skip the split offer and land a
      // single prompt instead. The flag is armed by the global keydown handler.
      const oneBlock = useStore.getState().oneBlockPaste;
      useStore.setState({ oneBlockPaste: false });
      setTimeout(() => void useStore.getState().pasteIntoCollection(text, oneBlock), 0);
    };
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("paste", onPaste);
      useStore.getState().setHoverPrompt(null);
    };
  }, []);

  const body = active?.body ?? "";
  const all = children.map((c) => `## ${c.title}\n\n${c.body}`).join("\n\n");
  const currentMatchId = matchingPromptIds[find?.index ?? 0];

  return (
    <section className="cards" data-type={type}>
      <header className="cards-head">
        <div className="cards-actions">
          <button
            className="secondary"
            onClick={() => void addPrompt()}
            data-tooltip="Add a prompt to this collection"
          >
            + Add prompt
          </button>
          <CopyButton text={all} label="Copy all" />
        </div>
      </header>

      {find && (
        <div className="find-bar" role="search">
          <input
            autoFocus
            value={find.query}
            placeholder="Find in this collection…"
            onChange={(event) => setFindQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                findMove(event.shiftKey ? -1 : 1);
              } else if (event.key === "Escape") {
                event.preventDefault();
                closeFind();
              }
            }}
          />
          <span className="find-count">
            {findCount > 0 ? `${Math.min(find.index + 1, findCount)} / ${findCount}` : "0 / 0"}
          </span>
          <button
            className="find-nav"
            data-tooltip="Previous (Shift+Enter)"
            onClick={() => findMove(-1)}
          >
            ↑
          </button>
          <button className="find-nav" data-tooltip="Next (Enter)" onClick={() => findMove(1)}>
            ↓
          </button>
          <button className="find-close" data-tooltip="Close (Esc)" onClick={closeFind}>
            ×
          </button>
        </div>
      )}

      {body.trim() && (
        <div className="collection-index" data-tooltip="[[links]] between these prompts">
          <Wikilinks text={body.trim()} query={find?.query} />
        </div>
      )}

      {children.length === 0 ? (
        <div className="collection-empty">
          <p>No prompts in this collection yet.</p>
          <p className="muted">
            Add one with <strong>+ Add prompt</strong>, or paste a batch of prompts here to
            split it into a linked set.
          </p>
        </div>
      ) : (
        <>
          <ul className="card-list">
            {children.map((prompt) => (
              <Card
                key={prompt.id}
                prompt={prompt}
                query={find?.query}
                isCurrentMatch={Boolean(find?.query && currentMatchId === prompt.id)}
                drag={{
                  ...cardDrag.rowProps(prompt.id),
                  isDragging: cardDrag.dragKey === prompt.id,
                  isOver: cardDrag.overKey === prompt.id && cardDrag.dragKey !== prompt.id,
                }}
              />
            ))}
          </ul>
          <button
            className="add-prompt-bottom"
            onClick={() => void addPrompt()}
            data-tooltip="Add a prompt to this collection"
          >
            + Add prompt
          </button>
        </>
      )}
    </section>
  );
}
