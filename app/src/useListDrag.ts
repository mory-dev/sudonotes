import { useEffect, useRef, useState } from "react";

/** What `useListDrag` hands a row, plus the two flags that style it. */
export interface NoteDragHandlers {
  "data-drag-key": string;
  "data-drag-list": string;
  onPointerDown: (event: React.PointerEvent) => void;
  isDragging: boolean;
  isOver: boolean;
}

/** Drag-to-reorder for one list, keyed by whatever identifies a row.
 *
 *  Pointer events rather than HTML5 drag-and-drop, avoiding native layer
 *  issues where dragstart inside webview fails to produce drops. */
export function useListDrag(listId: string, onCommit: (fromKey: string, toKey: string) => void) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const drag = useRef<{
    key: string;
    startX: number;
    startY: number;
    moved: boolean;
    over: string | null;
  } | null>(null);

  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  useEffect(() => {
    const finish = (commit: boolean) => {
      const current = drag.current;
      drag.current = null;
      document.body.classList.remove("row-dragging");
      setDragKey(null);
      setOverKey(null);
      if (!current?.moved) return;

      // A drag ends with a click on whatever the pointer went down on, which
      // would select the note the user was only moving. Swallow that one.
      const swallow = (event: MouseEvent) => {
        event.stopPropagation();
        window.removeEventListener("click", swallow, true);
      };
      window.addEventListener("click", swallow, true);
      setTimeout(() => window.removeEventListener("click", swallow, true), 250);
      if (commit && current.over && current.over !== current.key) {
        commitRef.current(current.key, current.over);
      }
    };

    const onMove = (event: PointerEvent) => {
      const current = drag.current;
      if (!current) return;

      // A small threshold, so a plain click on a row never starts a drag.
      if (
        !current.moved &&
        Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 4
      ) {
        return;
      }
      if (!current.moved) {
        current.moved = true;
        document.body.classList.add("row-dragging");
        setDragKey(current.key);
      }
      event.preventDefault();

      const under = document.elementFromPoint(event.clientX, event.clientY);
      const row = under?.closest<HTMLElement>("[data-drag-key]");
      const key =
        row && row.dataset.dragList === listId && row.dataset.dragKey !== current.key
          ? (row.dataset.dragKey ?? null)
          : null;
      current.over = key;
      setOverKey(key);
    };

    const onUp = () => finish(true);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [listId]);

  const rowProps = (key: string) => ({
    "data-drag-key": key,
    "data-drag-list": listId,
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      drag.current = {
        key,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        over: null,
      };
    },
  });

  return { dragKey, overKey, rowProps };
}

/** Move `fromKey` to where `toKey` sits, returning the reordered keys. */
export function reordered(keys: string[], fromKey: string, toKey: string): string[] | null {
  const from = keys.indexOf(fromKey);
  const to = keys.indexOf(toKey);
  if (from < 0 || to < 0 || from === to) return null;
  const next = keys.slice();
  next.splice(from, 1);
  next.splice(to, 0, fromKey);
  return next;
}
