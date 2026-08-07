/** Deterministic, GitHub-issue-style colors for tags. The same tag always gets
 *  the same hue, so tags stay recognizable across the app. */

function hueFor(tag: string): number {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

export interface TagPalette {
  bg: string;
  fg: string;
  border: string;
}

export function tagPalette(tag: string): TagPalette {
  const hue = hueFor(tag);
  return {
    bg: `hsl(${hue} 50% 20%)`,
    fg: `hsl(${hue} 75% 74%)`,
    border: `hsl(${hue} 45% 30%)`,
  };
}

/** A translucent tint for hover highlights derived from a tag's hue. Kept
 *  subtle and low-alpha so it never reads as selected text. */
export function tagHoverColor(tag: string): string {
  return `hsl(${hueFor(tag)} 70% 62% / 0.10)`;
}
