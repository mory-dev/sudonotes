export const MIN_PROMPT_HEIGHT = 70;
export const MAX_PROMPT_HEIGHT = 700;
export const DEFAULT_PROMPT_HEIGHT = 190;
export const PROMPT_HEIGHTS_STORAGE_KEY = "sudonotes:prompt-card-heights";

/**
 * Constrain resizing vertically with sensible limits (min 70px, max 700px).
 * Horizontal resizing is not permitted.
 */
export function clampPromptHeight(height: number): number {
  if (typeof height !== "number" || Number.isNaN(height)) {
    return MIN_PROMPT_HEIGHT;
  }
  return Math.min(MAX_PROMPT_HEIGHT, Math.max(MIN_PROMPT_HEIGHT, Math.round(height)));
}

/**
 * Load all saved customized prompt heights keyed by prompt ID from localStorage.
 */
export function loadPromptHeights(): Record<string, number> {
  if (typeof window === "undefined" || !window.localStorage) {
    return {};
  }
  try {
    const raw = localStorage.getItem(PROMPT_HEIGHTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};

    const validated: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && !Number.isNaN(value)) {
        validated[key] = clampPromptHeight(value);
      }
    }
    return validated;
  } catch {
    return {};
  }
}

/**
 * Persist a customized height for a prompt ID in localStorage.
 * Returns the clamped height that was stored.
 */
export function savePromptHeight(id: string, height: number): number {
  const clamped = clampPromptHeight(height);
  if (typeof window === "undefined" || !window.localStorage) {
    return clamped;
  }
  try {
    const map = loadPromptHeights();
    map[id] = clamped;
    localStorage.setItem(PROMPT_HEIGHTS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota or security errors gracefully
  }
  return clamped;
}

/**
 * Remove a customized height for a prompt ID from localStorage.
 */
export function removePromptHeight(id: string): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    const map = loadPromptHeights();
    delete map[id];
    localStorage.setItem(PROMPT_HEIGHTS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore errors
  }
}

/**
 * Clear all persisted prompt heights from localStorage.
 */
export function clearPromptHeights(): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    localStorage.removeItem(PROMPT_HEIGHTS_STORAGE_KEY);
  } catch {
    // Ignore errors
  }
}
