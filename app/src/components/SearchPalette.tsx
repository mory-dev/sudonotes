import { useEffect, useMemo, useRef, useState } from "react";

import { api, type SearchHit } from "../api";
import { useStore } from "../store";
import { TypeBadge } from "./NoteMarks";
import { ProviderIcon, providerOf } from "./ProviderMarks";

const DEBOUNCE_MS = 120;

/** The initial letter of a project folder's name, for the placeholder. */
function projectInitial(project: string): string {
  const name = project.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  return (name.charAt(0) || "?").toUpperCase();
}

export function SearchPalette() {
  const open = useStore((s) => s.paletteOpen);
  const setPalette = useStore((s) => s.setPalette);
  const paletteQuery = useStore((s) => s.paletteQuery);
  const select = useStore((s) => s.select);
  const notes = useStore((s) => s.notes);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // Look up project icons and models for search hits from the loaded list.
  const byId = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);

  useEffect(() => {
    if (open) {
      setQuery(paletteQuery);
      setHits([]);
      setCursor(0);
    }
  }, [open, paletteQuery]);

  useEffect(() => {
    if (!open) return;
    if (!query.trim()) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const results = await api.search(query, 50);
        // Guard against a slower earlier request landing after a newer one.
        if (cancelled) return;
        setHits(results);
        setCursor(0);
      } catch {
        if (!cancelled) setHits([]);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  useEffect(() => {
    listRef.current?.children[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  const choose = (id: string) => {
    setPalette(false);
    void select(id);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      setPalette(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, hits.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (event.key === "Enter" && hits[cursor]) {
      event.preventDefault();
      choose(hits[cursor].id);
    }
  };

  return (
    <div className="overlay" onMouseDown={() => setPalette(false)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
          placeholder="Search prompts and ideas…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {query.trim() && hits.length === 0 ? (
          <p className="empty">No matches</p>
        ) : (
          <ul className="palette-results" ref={listRef}>
            {hits.map((hit, i) => {
              const note = byId.get(hit.id);
              return (
                <li key={hit.id}>
                  <button
                    className={i === cursor ? "palette-item selected" : "palette-item"}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => choose(hit.id)}
                  >
                    <span className="palette-title">
                      <TypeBadge type={hit.type} />
                      {note?.project ? (
                        note.icon ? (
                          <img className="note-project-icon" src={note.icon} alt="" data-tooltip={note.project} />
                        ) : (
                          <span className="note-project-icon placeholder" data-tooltip={note.project}>
                            {projectInitial(note.project)}
                          </span>
                        )
                      ) : null}
                      {note?.model ? (
                        <ProviderIcon provider={providerOf(note.model)} size={13} />
                      ) : null}
                      {hit.title}
                    </span>
                    <span className="palette-snippet">{hit.snippet}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
