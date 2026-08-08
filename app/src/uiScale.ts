/** The app scales the document with CSS `zoom`. Pointer and DOM-rect values
 * are viewport pixels, while positioned descendants use the zoomed document's
 * layout pixels. Convert between those spaces before placing floating UI. */
export function getUiZoom(): number {
  const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

export function viewportToLayout(value: number, zoom = getUiZoom()): number {
  return value / zoom;
}
