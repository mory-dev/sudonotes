import { useEffect, useState } from "react";

import type { DraftPrompt } from "../api";
import { useStore } from "../store";

/** Confirmation step for a detected multi-prompt paste. Titles are editable and
 *  individual prompts can be dropped — the split is a guess, so nothing reaches
 *  disk until this is accepted. */
export function SplitPreview() {
  const drafts = useStore((s) => s.drafts);
  const confirmSplit = useStore((s) => s.confirmSplit);
  const cancelSplit = useStore((s) => s.cancelSplit);
  const collection = useStore((s) => s.active?.title);

  const [edited, setEdited] = useState<DraftPrompt[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEdited(drafts ?? []);
    setBusy(false);
  }, [drafts]);

  if (!drafts) return null;

  const rename = (index: number, title: string) =>
    setEdited((list) => list.map((d, i) => (i === index ? { ...d, title } : d)));

  const drop = (index: number) => setEdited((list) => list.filter((_, i) => i !== index));

  const accept = () => {
    setBusy(true);
    void confirmSplit(edited);
  };

  return (
    <div className="overlay" onMouseDown={cancelSplit}>
      <div className="split" onMouseDown={(e) => e.stopPropagation()}>
        <header className="split-head">
          <h2>
            Found {edited.length} prompt{edited.length === 1 ? "" : "s"} in that paste
          </h2>
          <p>
            Each becomes its own note inside <strong>{collection}</strong>, which turns
            into an index linking to them. Edit the titles or drop any that are wrong.
          </p>
        </header>

        <ul className="split-list">
          {edited.map((draft, i) => (
            <li key={i} className="split-item">
              <span className="split-index">{i + 1}</span>
              <div className="split-fields">
                <input
                  className="split-title"
                  value={draft.title}
                  onChange={(e) => rename(i, e.target.value)}
                  placeholder="Untitled prompt"
                />
                <p className="split-summary">{draft.summary}</p>
                {draft.tags.length > 0 && (
                  <ul className="split-tags">
                    {draft.tags.map((tag) => (
                      <li key={tag}>{tag}</li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                className="icon-button"
                data-tooltip="Remove this prompt"
                onClick={() => drop(i)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        <footer className="split-foot">
          <button className="secondary" onClick={cancelSplit}>
            Keep as one note
          </button>
          <button className="primary" onClick={accept} disabled={busy || edited.length < 2}>
            {busy ? "Splitting…" : `Create ${edited.length} prompts`}
          </button>
        </footer>
      </div>
    </div>
  );
}
