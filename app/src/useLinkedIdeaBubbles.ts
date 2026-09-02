import { useEffect, useMemo, useState } from "react";
import { api, type ChildPrompt, type NoteDetail, type NoteMeta } from "./api";
import { useStore } from "./store";
import {
  extractIdeaBubbles,
  getLinkedIdeaTitles,
  type IdeaBubble,
} from "./templateBubbles";

/** In-memory cache of parsed bubbles for notes by ID or title. */
const ideaBubbleCache = new Map<
  string,
  { updated: string; bubbles: IdeaBubble[] }
>();

/** Read cached bubbles for a note or active idea. */
export function getCachedIdeaBubbles(noteId: string): IdeaBubble[] | null {
  const cached = ideaBubbleCache.get(noteId);
  return cached ? cached.bubbles : null;
}

export function setCachedIdeaBubbles(
  noteId: string,
  updated: string,
  bubbles: IdeaBubble[],
) {
  ideaBubbleCache.set(noteId, { updated, bubbles });
}

export function useLinkedIdeaBubbles(
  targetNote?: NoteDetail | ChildPrompt | null,
) {
  const active = useStore((s) => s.active);
  const hoverPrompt = useStore((s) => s.hoverPrompt);
  const notes = useStore((s) => s.notes);
  const backlinks = useStore((s) => s.backlinks);

  const note = targetNote ?? hoverPrompt ?? active;
  const noteBody = note?.body ?? "";

  // Sync active idea note directly into cache
  useEffect(() => {
    if (active && active.type === "idea") {
      const bubbles = extractIdeaBubbles(active.body, active.title, active.id);
      setCachedIdeaBubbles(active.id, active.updated, bubbles);
    }
  }, [active?.id, active?.body, active?.updated, active?.title, active?.type]);

  const linkedTitles = useMemo(() => {
    return getLinkedIdeaTitles(noteBody, backlinks);
  }, [noteBody, backlinks]);

  // Find candidate idea notes in vault
  const candidateIdeaNotes = useMemo(() => {
    const matching: NoteMeta[] = [];
    const lowerLinked = new Set(linkedTitles.map((t) => t.toLowerCase()));

    // 1. Linked ideas first
    for (const n of notes) {
      if (n.type === "idea" && lowerLinked.has(n.title.toLowerCase())) {
        matching.push(n);
      }
    }

    // 2. Active idea note if not already included
    if (active && active.type === "idea" && !matching.some((m) => m.id === active.id)) {
      matching.push(active);
    }

    // 3. If no specific linked ideas, include other idea notes from the vault
    if (matching.length === 0) {
      for (const n of notes) {
        if (n.type === "idea") matching.push(n);
      }
    }

    return matching;
  }, [linkedTitles, notes, active]);

  const [asyncBubbles, setAsyncBubbles] = useState<Record<string, IdeaBubble[]>>({});

  useEffect(() => {
    let activeEffect = true;

    async function fetchMissing() {
      for (const ideaMeta of candidateIdeaNotes) {
        // If active note is this idea, use its live body
        if (active && active.id === ideaMeta.id && active.type === "idea") {
          const bubbles = extractIdeaBubbles(active.body, active.title, active.id);
          setCachedIdeaBubbles(active.id, active.updated, bubbles);
          if (activeEffect) {
            setAsyncBubbles((prev) => ({ ...prev, [ideaMeta.id]: bubbles }));
          }
          continue;
        }

        const cached = ideaBubbleCache.get(ideaMeta.id);
        if (cached && cached.updated === ideaMeta.updated) {
          if (activeEffect) {
            setAsyncBubbles((prev) => ({ ...prev, [ideaMeta.id]: cached.bubbles }));
          }
          continue;
        }

        try {
          const detail = await api.readNote(ideaMeta.id);
          if (!activeEffect) return;
          const bubbles = extractIdeaBubbles(detail.body, detail.title, detail.id);
          setCachedIdeaBubbles(detail.id, detail.updated, bubbles);
          setAsyncBubbles((prev) => ({ ...prev, [ideaMeta.id]: bubbles }));
        } catch {
          // Note may have been deleted or moved
        }
      }
    }

    void fetchMissing();

    return () => {
      activeEffect = false;
    };
  }, [candidateIdeaNotes, active?.id, active?.updated, active?.body, active?.type]);

  const allBubbles = useMemo(() => {
    const list: IdeaBubble[] = [];
    const seen = new Set<string>();

    for (const meta of candidateIdeaNotes) {
      const bubbles =
        asyncBubbles[meta.id] ??
        getCachedIdeaBubbles(meta.id) ??
        (active?.id === meta.id && active.type === "idea"
          ? extractIdeaBubbles(active.body, active.title, active.id)
          : []);

      for (const b of bubbles) {
        const key = `${b.sanitized}`;
        if (!seen.has(key)) {
          seen.add(key);
          list.push(b);
        }
      }
    }

    return list;
  }, [candidateIdeaNotes, asyncBubbles, active]);

  return {
    bubbles: allBubbles,
    linkedTitles,
    candidateNotes: candidateIdeaNotes,
  };
}
