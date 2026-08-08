import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getUiZoom, viewportToLayout } from "../uiScale";

/** How long the pointer must rest before a tooltip appears, so a quick pass
 *  over an icon never flashes one. */
const SHOW_DELAY_MS = 320;

interface Tip {
  text: string;
  x: number;
  y: number;
  below: boolean;
}

/** A single refined tooltip replacing the native `title` bubbles. Any element
 *  with a `data-tooltip` attribute gets one: rest the pointer on it and the
 *  tooltip appears next to the cursor (above it, or below near the top edge).
 *
 *  Mounted once at the app root; `title` attributes elsewhere have been
 *  converted to `data-tooltip`. */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<number | null>(null);
  const pending = useRef(false);

  useEffect(() => {
    let current: HTMLElement | null = null;
    let text = "";

    const clear = () => {
      pending.current = false;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      setTip(null);
    };

    const position = (x: number, y: number) => {
      const below = y < 90;
      const zoom = getUiZoom();
      const px = viewportToLayout(
        Math.min(window.innerWidth - 10, Math.max(10, x)),
        zoom,
      );
      const py = viewportToLayout(
        Math.min(window.innerHeight - 10, Math.max(10, y)),
        zoom,
      );
      setTip((prev) =>
        prev && prev.x === px && prev.y === py && prev.below === below
          ? prev
          : { text, x: px, y: py, below },
      );
    };

    const onOver = (event: MouseEvent) => {
      const el = (event.target as HTMLElement).closest<HTMLElement>("[data-tooltip]");
      if (el === current) return;
      clear();
      current = el;
      if (!el) return;
      const value = (el.getAttribute("data-tooltip") ?? "").trim();
      if (!value) {
        current = null;
        return;
      }
      text = value;
      pending.current = true;
      timer.current = window.setTimeout(() => {
        pending.current = false;
        position(event.clientX, event.clientY);
      }, SHOW_DELAY_MS);
    };

    const onOut = (event: MouseEvent) => {
      const to = event.relatedTarget as Node | null;
      if (current && (!to || !current.contains(to))) {
        current = null;
        clear();
      }
    };

    // Track the pointer so the tooltip stays pinned to the cursor, like a
    // native tooltip, instead of floating over the middle of a wide element.
    const onMove = (event: MouseEvent) => {
      if (current && !pending.current) position(event.clientX, event.clientY);
    };

    const onLayoutChange = () => clear();

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("scroll", onLayoutChange, true);
    window.addEventListener("resize", onLayoutChange);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("scroll", onLayoutChange, true);
      window.removeEventListener("resize", onLayoutChange);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!tip) return null;

  return createPortal(
    <div
      className={tip.below ? "tooltip below" : "tooltip"}
      style={{ left: tip.x, top: tip.y }}
      role="tooltip"
    >
      {tip.text}
    </div>,
    document.body,
  );
}
