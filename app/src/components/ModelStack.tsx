import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { NoteMeta } from "../api";
import { getUiZoom, viewportToLayout } from "../uiScale";
import { ProviderIcon, providerName, providerOf, shortModelName } from "./ProviderMarks";

/** How many icons show before the rest collapse into a +N bubble. */
const MAX_ICONS = 3;

/** The distinct models used across a collection's blocks, with how many blocks
 *  use each — most-used first, so the visible icons are the representative ones. */
function distinctModels(notes: NoteMeta[]) {
  const counts = new Map<string, number>();
  for (const note of notes) {
    const model = note.model?.trim();
    if (model) counts.set(model, (counts.get(model) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([model, count]) => ({ model, count }))
    .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model));
}

/** Horizontally stacked provider icons for the models used inside a collection. */
export function ModelStack({ notes }: { notes: NoteMeta[] }) {
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const models = useMemo(() => distinctModels(notes), [notes]);

  if (models.length === 0) return null;

  const shown = models.slice(0, MAX_ICONS);
  const hidden = models.length - shown.length;
  const untagged = notes.length - models.reduce((sum, m) => sum + m.count, 0);

  // The sidebar clips its overflow, so the popup is rendered to the body and
  // positioned against the icons.
  const show = () => {
    const box = anchor.current?.getBoundingClientRect();
    if (box) {
      const zoom = getUiZoom();
      setAt({
        top: viewportToLayout(box.bottom + 6, zoom),
        right: viewportToLayout(window.innerWidth - box.right, zoom),
      });
    }
  };

  return (
    <span
      className="model-stack"
      ref={anchor}
      onMouseEnter={show}
      onMouseLeave={() => setAt(null)}
    >
      {shown.map(({ model }) => (
        <span className="model-stack-item" key={model}>
          <ProviderIcon provider={providerOf(model)} size={13} />
        </span>
      ))}

      {hidden > 0 && <span className="model-stack-more">+{hidden}</span>}

      {at &&
        createPortal(
          <div className="model-popup" role="tooltip" style={{ top: at.top, right: at.right }}>
            <span className="model-popup-head">
              {models.length} model{models.length === 1 ? "" : "s"} in this collection
            </span>
            <span className="model-popup-list">
              {models.map(({ model, count }) => (
                <span className="model-popup-row" key={model}>
                  <ProviderIcon provider={providerOf(model)} size={14} />
                  <span className="model-popup-name">
                    <strong>{shortModelName(model, providerOf(model))}</strong>
                    <em>{providerName(providerOf(model))}</em>
                  </span>
                  <span className="model-popup-count">{count}</span>
                </span>
              ))}
            </span>
            {untagged > 0 && (
              <span className="model-popup-foot">{untagged} without a model</span>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
