import { useMemo, useRef, useState } from "react";

import { TagChip } from "./TagChip";

/** A bubble-style tag editor: each tag renders as a removable chip, typing
 *  commits on Enter or comma, and existing tags are suggested as you type. */
export function TagInput({
  value,
  onChange,
  suggestions,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const needle = text.trim().toLowerCase();
    if (!needle) return [];
    return (suggestions ?? [])
      .filter((tag) => !value.includes(tag) && tag.toLowerCase().includes(needle))
      .slice(0, 20);
  }, [text, suggestions, value]);

  const addTags = (raw: string) => {
    const tags = raw
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const fresh = tags.filter((tag) => !value.includes(tag));
    if (fresh.length > 0) onChange([...value, ...fresh]);
  };

  const commit = (raw: string) => {
    addTags(raw);
    setText("");
    setOpen(false);
    setCursor(0);
    inputRef.current?.focus();
  };

  const remove = (tag: string) => onChange(value.filter((current) => current !== tag));

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (matches[cursor]) commit(matches[cursor]);
      else commit(text);
    } else if (event.key === ",") {
      event.preventDefault();
      commit(text);
    } else if (event.key === "Backspace" && !text && value.length > 0) {
      onChange(value.slice(0, -1));
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((current) => Math.min(current + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((current) => Math.max(current - 1, 0));
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="tag-input" ref={root}>
      {value.map((tag) => (
        <TagChip key={tag} tag={tag} onRemove={() => remove(tag)} />
      ))}
      <input
        ref={inputRef}
        value={text}
        placeholder={value.length === 0 ? "Add tags…" : ""}
        onChange={(event) => {
          const next = event.target.value;
          if (next.includes(",")) {
            // A paste or keystroke with commas wraps each value as a bubble.
            const lastComma = next.lastIndexOf(",");
            addTags(next.slice(0, lastComma));
            setText(next.slice(lastComma + 1));
          } else {
            setText(next);
          }
          setOpen(true);
          setCursor(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />

      {open && matches.length > 0 && (
        <ul className="tag-suggestions">
          {matches.map((tag, index) => (
            <li key={tag}>
              <button
                className={index === cursor ? "active" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(tag)}
                onMouseEnter={() => setCursor(index)}
              >
                {tag}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
