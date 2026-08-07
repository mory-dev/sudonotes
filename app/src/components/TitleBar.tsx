import { useEffect, useRef, useState } from "react";

import { useStore } from "../store";
import { TypeBadge } from "./NoteMarks";

export function TitleBar() {
  const active = useStore((s) => s.active);
  const dirty = useStore((s) => s.dirty);
  const rename = useStore((s) => s.rename);
  const remove = useStore((s) => s.remove);
  const requestConfirm = useStore((s) => s.requestConfirm);

  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(active?.title ?? ""), [active?.id, active?.title]);

  if (!active) return null;

  const commit = () => {
    const next = draft.trim();
    if (!next || next === active.title) {
      setDraft(active.title);
      return;
    }
    void rename(next);
  };

  const onDelete = () => {
    requestConfirm(
      `Delete "${active.title}"? This cannot be undone.`,
      () => void remove(active.id),
      "Delete",
    );
  };

  return (
    <header className="title-bar">
      <TypeBadge type={active.type} />
      <input
        ref={input}
        className="title-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setDraft(active.title);
        }}
      />
      <span className={dirty ? "save-state dirty" : "save-state"}>
        {dirty ? "Saving…" : "Saved"}
      </span>
      <button className="delete-button" title="Delete note" onClick={onDelete}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 4.5h11" />
          <path d="M6 4.5V2.5h4v2" />
          <path d="M4 4.5V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.5" />
        </svg>
      </button>
    </header>
  );
}
