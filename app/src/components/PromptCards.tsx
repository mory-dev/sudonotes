import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { api, type ChildPrompt } from "../api";
import { useStore } from "../store";
import { ModelPicker } from "./ModelPicker";
import { ProviderIcon, providerOf, shortModelName } from "./ProviderMarks";
import { TagChip } from "./TagChip";
import { TagInput } from "./TagInput";

/** Render `[[Target]]` (and `[[Target|alias]]`) as clickable links, everything
 *  else as plain text. Newlines are preserved by the caller's white-space. */
function Wikilinks({ text }: { text: string }) {
  const openLink = useStore((s) => s.openLink);

  const parts: ReactNode[] = [];
  const re = /\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g;
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const target = match[1].trim();
    const alias = match[2]?.trim();
    parts.push(
      <button
        key={key++}
        className="wiki-link"
        data-target={target}
        data-tooltip={`Open "${target}"`}
        onClick={() => void openLink(target)}
      >
        {alias || target}
      </button>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));

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
function Card({ prompt }: { prompt: ChildPrompt }) {
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
    return (
      <li
        className="card"
        onDoubleClick={() => setEditing(true)}
        data-tooltip="Double-click to edit"
      >
        <header className="card-head">
          {prompt.position != null && <span className="card-index">{prompt.position}</span>}
          <button
            className="card-title"
            data-tooltip="Open this prompt"
            onClick={() => void select(prompt.id)}
          >
            {prompt.title}
          </button>
          <CopyButton text={prompt.body} />
        </header>

        <pre className="card-body">
          <Wikilinks text={prompt.body} />
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
    <li className="card editing">
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

  // Pasting a batch into a collection offers to split it into prompts, exactly
  // as the editor does for a single note. A single prompt lands directly.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea")) return;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (text.trim()) {
        setTimeout(() => void useStore.getState().pasteIntoCollection(text), 0);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const body = active?.body ?? "";
  const all = children.map((c) => `## ${c.title}\n\n${c.body}`).join("\n\n");

  return (
    <section className="cards" data-type={type}>
      <header className="cards-head">
        <span>
          Prompts in this collection <span className="count">{children.length}</span>
        </span>
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

      {body.trim() && (
        <div className="collection-index" data-tooltip="[[links]] between these prompts">
          <Wikilinks text={body.trim()} />
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
        <ul className="card-list">
          {children.map((prompt) => (
            <Card key={prompt.id} prompt={prompt} />
          ))}
        </ul>
      )}
    </section>
  );
}
