import { tagPalette } from "../tagColors";

/** A colored tag bubble, using the tag's auto-generated hue. Pass `onClick` to
 *  make it searchable. */
export function TagChip({
  tag,
  onRemove,
  onClick,
}: {
  tag: string;
  onRemove?: () => void;
  onClick?: () => void;
}) {
  const palette = tagPalette(tag);
  return (
    <span
      className={onClick ? "tag-chip clickable" : "tag-chip"}
      style={{ background: palette.bg, color: palette.fg, borderColor: palette.border }}
      onClick={onClick}
      title={onClick ? `Search "${tag}"` : undefined}
    >
      {tag}
      {onRemove && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          title={`Remove "${tag}"`}
          aria-label={`Remove ${tag}`}
        >
          ×
        </button>
      )}
    </span>
  );
}
