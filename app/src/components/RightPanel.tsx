import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../api";
import { useStore } from "../store";
import {
  findMatchingBubble,
  getTemplateVariableAutocompleteState,
  insertTemplateVariable,
  placeholdersIn,
  substituteTemplateVariables,
  type IdeaBubble,
} from "../templateBubbles";
import { useLinkedIdeaBubbles } from "../useLinkedIdeaBubbles";
import { AiReview } from "./AiReview";
import { ModelPicker } from "./ModelPicker";
import { IdeaMark, PromptMark, TypeBadge } from "./NoteMarks";
import { ProjectLink } from "./ProjectLink";
import { TagChip } from "./TagChip";
import { TagInput } from "./TagInput";
import { resolveBubbleModel, resolveBubbleTags } from "./Editor";
import { TemplateVariableAutocomplete } from "./TemplateVariableAutocomplete";

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

function VariableRow({
  name,
  value,
  onChange,
  bubbles,
}: {
  name: string;
  value: string;
  onChange: (val: string) => void;
  bubbles: IdeaBubble[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const matchedBubble = useMemo(() => findMatchingBubble(name, bubbles), [name, bubbles]);

  const placeholderText = matchedBubble
    ? matchedBubble.content.length > 35
      ? `${matchedBubble.content.slice(0, 35)}…`
      : matchedBubble.content
    : "value";

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    onChange(text);

    const pos = e.target.selectionStart ?? text.length;
    const auto = getTemplateVariableAutocompleteState(text, pos);
    if (auto) {
      setQuery(auto.query);
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  const handleSelect = (bubble: IdeaBubble) => {
    const el = inputRef.current;
    const pos = el?.selectionStart ?? value.length;
    const auto = getTemplateVariableAutocompleteState(value, pos);
    if (auto) {
      const res = insertTemplateVariable(value, pos, bubble.sanitized, false);
      onChange(res.newText);
    } else {
      onChange(bubble.content || bubble.label);
    }
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <li>
      <div className="variable-name-row">
        <label className="variable-name" htmlFor={`var-${name}`}>
          {name}
        </label>
        {matchedBubble && (
          <span
            className="variable-preview-badge"
            title={`Auto-substitutes from "${matchedBubble.label}" in ${matchedBubble.noteTitle ?? "idea"}`}
          >
            💡 {matchedBubble.noteTitle ? `${matchedBubble.noteTitle}: ` : ""}{matchedBubble.label}
          </span>
        )}
      </div>
      <div className="variable-input-wrap">
        <input
          ref={inputRef}
          id={`var-${name}`}
          className="variable-input"
          value={value}
          placeholder={placeholderText}
          onChange={handleInputChange}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          onBlur={() => {
            setTimeout(() => setOpen(false), 200);
          }}
        />
        {open && (
          <TemplateVariableAutocomplete
            bubbles={bubbles}
            query={query}
            onSelect={handleSelect}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    </li>
  );
}

/** Fill in a prompt's `{{placeholders}}` with ideas bubbles or user values,
 *  providing smooth preview substitution and copying the result. */
function Variables() {
  const active = useStore((s) => s.active);
  const hoverPrompt = useStore((s) => s.hoverPrompt);
  const target = hoverPrompt ?? active;
  const isPrompt = hoverPrompt ? true : active?.type === "prompt";
  const body = target?.body ?? "";
  const names = useMemo(() => (isPrompt ? placeholdersIn(body) : []), [isPrompt, body]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const { bubbles } = useLinkedIdeaBubbles(target);

  useEffect(() => {
    setValues({});
  }, [target?.id]);

  if (names.length === 0) return null;

  const filled = substituteTemplateVariables(body, bubbles, values);

  const remaining = names.filter((name) => {
    if (values[name]) return false;
    const match = findMatchingBubble(name, bubbles);
    return !match;
  }).length;

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
        <button
          type="button"
          className={`variable-preview-toggle ${showPreview ? "active" : ""}`}
          onClick={() => setShowPreview((prev) => !prev)}
          title="Toggle preview substitution"
        >
          {showPreview ? "Hide preview" : "Preview"}
        </button>
      </header>

      {showPreview && (
        <div className="variables-preview-box" title="Substituted preview text">
          {filled}
        </div>
      )}

      <ul className="variable-list">
        {names.map((name) => (
          <VariableRow
            key={name}
            name={name}
            value={values[name] ?? ""}
            bubbles={bubbles}
            onChange={(val) => setValues((current) => ({ ...current, [name]: val }))}
          />
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
              value={resolveBubbleTags(note.bubbleTags, bubble!)}
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
                value={resolveBubbleModel(note.models, bubble!) ?? ""}
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
