import { useEffect, useMemo, useState } from "react";

import { api } from "../api";
import { useStore } from "../store";
import { AiReview } from "./AiReview";
import { ModelPicker } from "./ModelPicker";
import { IdeaMark, PromptMark, TypeBadge } from "./NoteMarks";
import { ProjectLink } from "./ProjectLink";
import { TagChip } from "./TagChip";
import { TagInput } from "./TagInput";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="meta-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Backlinks() {
  const backlinks = useStore((s) => s.backlinks);
  const select = useStore((s) => s.select);
  const title = useStore((s) => s.active?.title);

  return (
    <section className="panel-section">
      <header className="section-header">
        <span>
          Linked from <span className="count">{backlinks.length}</span>
        </span>
      </header>

      {backlinks.length === 0 ? (
        <p className="empty">
          Nothing links here yet. Write <code>[[{title ?? "Note title"}]]</code> in another
          note, or right-click a selection to link it.
        </p>
      ) : (
        <ul className="note-list">
          {backlinks.map((note) => (
            <li key={note.id} data-type={note.type}>
              <button className="note-item" onClick={() => void select(note.id)}>
                <span className="pick-mark">
                  {note.type === "prompt" ? <PromptMark /> : <IdeaMark />}
                </span>
                {note.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Every distinct `{{name}}` in a prompt, in the order it first appears. */
function placeholdersIn(body: string): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    const name = match[1].trim();
    if (name && !found.includes(name)) found.push(name);
  }
  return found;
}

/** Fill in a prompt's `{{placeholders}}` and copy the result.
 *
 *  Values live for the session only and are never written back: the note stays
 *  a reusable template, and what goes on the clipboard is the filled copy. */
function Variables() {
  const active = useStore((s) => s.active);
  const hoverPrompt = useStore((s) => s.hoverPrompt);
  const target = hoverPrompt ?? active;
  const isPrompt = hoverPrompt ? true : active?.type === "prompt";
  const body = target?.body ?? "";
  const names = useMemo(() => (isPrompt ? placeholdersIn(body) : []), [isPrompt, body]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setValues({});
  }, [target?.id]);

  if (names.length === 0) return null;

  const filled = body.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, name: string) => {
    const value = values[name.trim()];
    // An unfilled placeholder is left standing rather than blanked, so a
    // half-filled copy still shows what is missing.
    return value ? value : whole;
  });

  const remaining = names.filter((name) => !values[name]).length;

  const copy = () => {
    void navigator.clipboard.writeText(filled);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <section className="panel-section variables">
      <header className="section-header">
        <span>
          Variables <span className="count">{names.length}</span>
        </span>
      </header>

      <ul className="variable-list">
        {names.map((name) => (
          <li key={name}>
            <label className="variable-name" htmlFor={`var-${name}`}>
              {name}
            </label>
            <input
              id={`var-${name}`}
              className="variable-input"
              value={values[name] ?? ""}
              placeholder="value"
              onChange={(event) =>
                setValues((current) => ({ ...current, [name]: event.target.value }))
              }
            />
          </li>
        ))}
      </ul>

      <button className="ai-analyze" onClick={copy}>
        {copied ? "Copied" : remaining > 0 ? `Copy filled (${remaining} blank)` : "Copy filled"}
      </button>
    </section>
  );
}

function Metadata() {
  const note = useStore((s) => s.active);
  const hoverPrompt = useStore((s) => s.hoverPrompt);
  const notes = useStore((s) => s.notes);
  const openLink = useStore((s) => s.openLink);
  const updateModel = useStore((s) => s.updateModel);
  const setBubbleModel = useStore((s) => s.setBubbleModel);
  const setBubbleTags = useStore((s) => s.setBubbleTags);
  const refresh = useStore((s) => s.refresh);
  // Hover wins; the caret is what it falls back to when the mouse is elsewhere.
  const bubble = useStore((s) => s.hoverBubble ?? s.cursorBubble);
  const tagSuggestions = useMemo(() => {
    const tags = new Set(notes.flatMap((candidate) => candidate.tags));
    for (const values of Object.values(note?.bubbleTags ?? {})) {
      for (const tag of values) tags.add(tag);
    }
    return [...tags].sort((left, right) => left.localeCompare(right));
  }, [note?.bubbleTags, notes]);

  if (!note) return null;

  if (hoverPrompt) {
    const meta = notes.find((n) => n.id === hoverPrompt.id);
    return (
      <section className="panel-section metadata" data-type="prompt">
        <header className="section-header">
          <span>Details</span>
        </header>

        {meta?.summary && <p className="meta-summary">{meta.summary}</p>}

        <dl className="meta-list">
          <Row label="Type">
            <TypeBadge type="prompt" />
          </Row>

          <Row label="Collection">
            <button className="meta-link" onClick={() => void openLink(note.title)}>
              {note.title}
              {hoverPrompt.position != null && <span className="count">#{hoverPrompt.position}</span>}
            </button>
          </Row>

          <Row label="Tags">
            {hoverPrompt.tags.length > 0 ? (
              <ul className="meta-tags">
                {hoverPrompt.tags.map((tag) => (
                  <li key={tag}>
                    <TagChip tag={tag} onClick={() => useStore.getState().openPalette(tag)} />
                  </li>
                ))}
              </ul>
            ) : (
              <span className="muted">None</span>
            )}
          </Row>

          <Row label="Model">
            <ModelPicker
              key={hoverPrompt.id}
              value={hoverPrompt.model ?? ""}
              onChange={async (value) => {
                try {
                  await api.updateModel(hoverPrompt.id, value || null);
                  await refresh();
                } catch {}
              }}
            />
          </Row>

          {meta?.updated && <Row label="Updated">{formatDate(meta.updated)}</Row>}
        </dl>
      </section>
    );
  }

  // In an idea, the Model row addresses whichever bubble is live rather than
  // the note as a whole — that is the granularity a model is assigned at.
  const onBubble = note.type === "idea" && bubble !== null;

  return (
    <section className="panel-section metadata" data-type={note.type}>
      <header className="section-header">
        <span>Details</span>
      </header>

      {note.summary && <p className="meta-summary">{note.summary}</p>}

      <dl className="meta-list">
        <Row label="Type">
          <TypeBadge type={note.type} />
        </Row>

        {note.collection && (
          <Row label="Collection">
            <button className="meta-link" onClick={() => void openLink(note.collection!)}>
              {note.collection}
              {note.position != null && <span className="count">#{note.position}</span>}
            </button>
          </Row>
        )}

        <Row label="Tags">
          {note.tags.length > 0 ? (
            <ul className="meta-tags">
              {note.tags.map((tag) => (
                <li key={tag}>
                  <TagChip tag={tag} onClick={() => useStore.getState().openPalette(tag)} />
                </li>
              ))}
            </ul>
          ) : (
            <span className="muted">None</span>
          )}
        </Row>

        {onBubble && (
          <Row label="Bubble">
            <span className="meta-bubble" data-tooltip={bubble!}>
              {bubble}
            </span>
          </Row>
        )}

        {onBubble && (
          <Row label="Bubble tags">
            <TagInput
              key={bubble!}
              value={note.bubbleTags?.[bubble!] ?? []}
              suggestions={tagSuggestions}
              onChange={(tags) => void setBubbleTags(bubble!, tags)}
            />
          </Row>
        )}

        {note.type === "prompt" || note.type === "idea" ? (
          <Row label={onBubble ? "Bubble model" : "Model"}>
            {onBubble ? (
              <ModelPicker
                key={bubble!}
                value={note.models?.[bubble!] ?? ""}
                onChange={(value) => void setBubbleModel(bubble!, value || null)}
              />
            ) : (
              <ModelPicker
                value={note.model ?? ""}
                onChange={(value) => void updateModel(value || null)}
              />
            )}
          </Row>
        ) : null}

        <Row label="Created">{formatDate(note.created)}</Row>
        <Row label="Updated">{formatDate(note.updated)}</Row>

        <Row label="File">
          <span className="meta-path" data-tooltip={note.path}>
            {note.path}
          </span>
        </Row>
      </dl>
    </section>
  );
}

export function RightPanel() {
  const isIdea = useStore((s) => s.active?.type === "idea");
  const holdHoverPrompt = useStore((s) => s.holdHoverPrompt);
  const releaseHoverPrompt = useStore((s) => s.releaseHoverPrompt);

  return (
    <aside
      className="right-panel"
      onMouseEnter={holdHoverPrompt}
      onMouseLeave={releaseHoverPrompt}
    >
      <div className="panel-split">
        <Backlinks />
      </div>
      <div className="panel-split">
        {isIdea && <ProjectLink />}
        <Variables />
        <Metadata />
        <AiReview />
      </div>
    </aside>
  );
}
