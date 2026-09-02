import { BUBBLE_END, BUBBLE_START, bubbleMarkerPairs } from "./store";

export interface IdeaBubble {
  id?: string;
  noteId?: string;
  noteTitle?: string;
  label: string;
  sanitized: string;
  content: string;
  rawText: string;
}

export interface AutocompleteState {
  isOpen: boolean;
  query: string;
  from: number;
  to: number;
}

/** Sanitize a bubble label or text into a clean snake_case template variable identifier. */
export function sanitizeBubbleVarName(text: string): string {
  const cleaned = text
    .replace(/^#{1,6}\s+/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/[[\]()*~`]/g, "")
    .trim();

  const ident = cleaned
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  return ident || "variable";
}

/** The first non-empty content line of a bubble, markdown headings and markers stripped. */
export function bubbleFirstText(raw: string): string {
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (t === BUBBLE_START || t === BUBBLE_END || !t) continue;
    return t.replace(/^#{1,6}\s+/, "").trim();
  }
  return "";
}

/** The body text of a bubble, skipping marker lines and separating heading from body if present. */
export function bubbleBodyText(raw: string): string {
  const lines = raw.split("\n").filter((l) => {
    const t = l.trim();
    return t !== BUBBLE_START && t !== BUBBLE_END;
  });
  if (lines.length === 0) return "";
  // If first line is a markdown heading and more lines exist, return the subsequent lines
  if (/^#{1,6}\s+/.test(lines[0].trim()) && lines.length > 1) {
    const rest = lines.slice(1).join("\n").trim();
    if (rest) return rest;
  }
  return lines.join("\n").trim();
}

/** Extract blank-line and marker-pair separated idea bubbles from an idea note body. */
export function extractIdeaBubbles(
  body: string,
  noteTitle?: string,
  noteId?: string,
): IdeaBubble[] {
  if (!body || !body.trim()) return [];

  const pairs = bubbleMarkerPairs(body);
  const ranges: { from: number; to: number }[] = [];
  let from = -1;
  let offset = 0;

  for (const line of body.split("\n")) {
    if (pairs.some((p) => offset >= p.from && offset <= p.to)) {
      if (from >= 0) {
        ranges.push({ from, to: offset - 1 });
        from = -1;
      }
    } else if (line.trim() === "") {
      if (from >= 0) {
        ranges.push({ from, to: offset - 1 });
        from = -1;
      }
    } else if (from < 0) {
      from = offset;
    }
    offset += line.length + 1;
  }
  if (from >= 0) ranges.push({ from, to: body.length });

  ranges.push(...pairs);
  ranges.sort((a, b) => a.from - b.from);

  const bubbles: IdeaBubble[] = [];
  let index = 0;
  for (const range of ranges) {
    const rawText = body.slice(range.from, range.to).trim();
    if (!rawText) continue;

    const label = bubbleFirstText(rawText);
    if (!label) continue;

    const sanitized = sanitizeBubbleVarName(label);
    const content = bubbleBodyText(rawText);

    bubbles.push({
      id: `${noteId ?? "note"}-bubble-${index++}`,
      noteId,
      noteTitle,
      label,
      sanitized,
      content: content || label,
      rawText,
    });
  }

  return bubbles;
}

/** Parse all distinct `{{name}}` placeholders from a template string. */
export function placeholdersIn(body: string): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    const name = match[1].trim();
    if (name && !found.includes(name)) found.push(name);
  }
  return found;
}

/** Extract linked idea note titles from `[[Note Title]]` wikilinks and backlinks. */
export function getLinkedIdeaTitles(
  promptBody: string,
  backlinks?: { title: string; type?: string }[],
): string[] {
  const titles = new Set<string>();
  const re = /\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(promptBody))) {
    const target = match[1].trim();
    if (target) titles.add(target);
  }
  if (backlinks) {
    for (const b of backlinks) {
      if (!b.type || b.type === "idea") {
        titles.add(b.title.trim());
      }
    }
  }
  return [...titles];
}

/** Detect if the cursor position is in an active `{{` autocomplete trigger state. */
export function getTemplateVariableAutocompleteState(
  text: string,
  cursorPos: number,
): AutocompleteState | null {
  if (cursorPos < 2) return null;
  const before = text.slice(0, cursorPos);
  const openIdx = before.lastIndexOf("{{");
  if (openIdx === -1) return null;

  // If there is a closed }} between {{ and cursorPos, not active
  const closingIdx = before.indexOf("}}", openIdx);
  if (closingIdx !== -1 && closingIdx + 2 <= cursorPos) {
    return null;
  }

  // Multiline trigger is not supported to keep autocomplete scoped
  const lineBreakIdx = before.indexOf("\n", openIdx);
  if (lineBreakIdx !== -1) return null;

  const query = before.slice(openIdx + 2);

  // Check if there is an existing closing }} after the cursor
  const after = text.slice(cursorPos);
  const closeAfterMatch = /^([^}\n]*)\}\}?/.exec(after);
  const to = closeAfterMatch ? cursorPos + closeAfterMatch[0].length : cursorPos;

  return {
    isOpen: true,
    query,
    from: openIdx,
    to,
  };
}

/** Insert a variable name or tag at the autocomplete trigger range or cursor. */
export function insertTemplateVariable(
  text: string,
  cursorPos: number,
  variableName: string,
  asTag = true,
): { newText: string; newCursorPos: number } {
  const state = getTemplateVariableAutocompleteState(text, cursorPos);
  const insertText = asTag ? `{{${variableName}}}` : variableName;

  if (!state) {
    const newText = text.slice(0, cursorPos) + insertText + text.slice(cursorPos);
    return { newText, newCursorPos: cursorPos + insertText.length };
  }

  const newText = text.slice(0, state.from) + insertText + text.slice(state.to);
  return { newText, newCursorPos: state.from + insertText.length };
}

/** Find matching bubble by variable name, checking sanitized names and raw labels. */
export function findMatchingBubble(
  varName: string,
  bubbles: IdeaBubble[],
): IdeaBubble | null {
  const trimmed = varName.trim();
  const sanitized = sanitizeBubbleVarName(trimmed);

  return (
    bubbles.find((b) => b.sanitized === sanitized) ??
    bubbles.find((b) => b.sanitized.toLowerCase() === sanitized.toLowerCase()) ??
    bubbles.find((b) => b.label.toLowerCase() === trimmed.toLowerCase()) ??
    bubbles.find((b) => sanitizeBubbleVarName(b.label) === sanitized) ??
    null
  );
}

/** Substitute template variables with matching bubble contents or user-specified values. */
export function substituteTemplateVariables(
  template: string,
  bubbles: IdeaBubble[],
  values: Record<string, string> = {},
): string {
  if (!template) return "";

  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, rawName: string) => {
    const name = rawName.trim();
    if (values[name] !== undefined && values[name] !== "") {
      return values[name];
    }
    const match = findMatchingBubble(name, bubbles);
    if (match) {
      return match.content || match.label;
    }
    return whole;
  });
}
