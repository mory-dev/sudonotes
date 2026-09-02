import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { type IdeaBubble } from "../templateBubbles";

function HighlightMatch({ text, query }: { text: string; query: string }) {
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

export interface TemplateVariableAutocompleteProps {
  bubbles: IdeaBubble[];
  query: string;
  onSelect: (bubble: IdeaBubble) => void;
  onClose?: () => void;
  className?: string;
}

export function TemplateVariableAutocomplete({
  bubbles,
  query,
  onSelect,
  onClose,
  className = "",
}: TemplateVariableAutocompleteProps) {
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const needle = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!needle) return bubbles.slice(0, 30);
    return bubbles
      .filter(
        (b) =>
          b.sanitized.toLowerCase().includes(needle) ||
          b.label.toLowerCase().includes(needle) ||
          b.content.toLowerCase().includes(needle),
      )
      .sort((a, b) => {
        const aSan = a.sanitized.toLowerCase();
        const bSan = b.sanitized.toLowerCase();
        const aExact = aSan.startsWith(needle) ? -1 : 0;
        const bExact = bSan.startsWith(needle) ? -1 : 0;
        return aExact - bExact;
      })
      .slice(0, 30);
  }, [bubbles, needle]);

  useEffect(() => {
    setCursor(0);
  }, [query, filtered.length]);

  useEffect(() => {
    const listEl = listRef.current;
    if (!listEl) return;
    const activeEl = listEl.querySelector<HTMLElement>(".active");
    if (activeEl && typeof activeEl.scrollIntoView === "function") {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [cursor]);

  if (filtered.length === 0) {
    return (
      <div className={`variable-autocomplete-popup empty ${className}`}>
        <div className="var-auto-empty">
          {bubbles.length === 0
            ? "No idea bubbles available in linked notes"
            : `No bubble matching "${query}"`}
        </div>
      </div>
    );
  }

  return (
    <ul
      ref={listRef}
      className={`variable-autocomplete-popup ${className}`}
      role="listbox"
      aria-label="Idea bubble autocomplete"
    >
      <li className="var-auto-header">
        <span>Idea Bubbles ({filtered.length})</span>
        {onClose ? (
          <button
            type="button"
            className="var-auto-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        ) : (
          <span className="var-auto-hint">Tab / Enter to insert · Esc to close</span>
        )}
      </li>
      {filtered.map((bubble, index) => {
        const isActive = index === cursor;
        return (
          <li key={bubble.id ?? `${bubble.sanitized}-${index}`} role="option" aria-selected={isActive}>
            <button
              type="button"
              className={`var-auto-item ${isActive ? "active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(bubble);
              }}
              onMouseEnter={() => setCursor(index)}
            >
              <div className="var-auto-title-row">
                <span className="var-auto-tag">
                  {"{{"}
                  <HighlightMatch text={bubble.sanitized} query={query} />
                  {"}}"}
                </span>
                {bubble.noteTitle && (
                  <span className="var-auto-note" title={`From ${bubble.noteTitle}`}>
                    {bubble.noteTitle}
                  </span>
                )}
              </div>
              <div className="var-auto-label">
                <HighlightMatch text={bubble.label} query={query} />
              </div>
              {bubble.content && bubble.content !== bubble.label && (
                <div className="var-auto-snippet">
                  {bubble.content.length > 90 ? `${bubble.content.slice(0, 90)}…` : bubble.content}
                </div>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
