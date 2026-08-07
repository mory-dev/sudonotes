import { useEffect, useMemo, useRef, useState } from "react";

import { useStore } from "../store";
import { IdeaMark, PromptMark } from "./NoteMarks";

/** Pick an existing note to link to. Filters the already-loaded list, so it
 *  stays instant and needs no round trip. */
export function NotePicker() {
  const open = useStore((s) => s.linkPickerOpen);
  const setLinkPicker = useStore((s) => s.setLinkPicker);
  const requestLink = useStore((s) => s.requestLink);
  const notes = useStore((s) => s.notes);
  const activeId = useStore((s) => s.active?.id);

  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
    }
  }, [open]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return notes
      .filter((n) => n.id !== activeId)
      .filter((n) => !needle || n.title.toLowerCase().includes(needle))
      .slice(0, 50);
  }, [notes, query, activeId]);

  useEffect(() => {
    listRef.current?.children[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  const choose = (title: string) => requestLink(title);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      setLinkPicker(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (event.key === "Enter" && matches[cursor]) {
      event.preventDefault();
      choose(matches[cursor].title);
    }
  };

  return (
    <div className="overlay" onMouseDown={() => setLinkPicker(false)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
          placeholder="Link to which note?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {matches.length === 0 ? (
          <p className="empty">No other notes yet</p>
        ) : (
          <ul className="palette-results" ref={listRef}>
            {matches.map((note, i) => (
              <li key={note.id}>
                <button
                  className={i === cursor ? "palette-item selected" : "palette-item"}
                  data-type={note.type}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choose(note.title)}
                >
                  <span className="palette-title">
                    <span className="pick-mark">
                      {note.type === "prompt" ? <PromptMark /> : <IdeaMark />}
                    </span>
                    {note.title}
                    {note.collection && <span className="in-collection">{note.collection}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
