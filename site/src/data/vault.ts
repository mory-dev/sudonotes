/**
 * The mock vault the site's previews are built from.
 *
 * Two shapes, deliberately different: `collections` are *buckets of reusable
 * prompts* named after the job they do ("Shipper prompts"), and `ideas` are the
 * projects being built ("AI Fridge"). A visitor should be able to tell the two
 * apart from the sidebar alone. Model ids are real (`anthropic/claude-opus-5`,
 * `deepseek/deepseek-v4`) so `providerOf`/`shortModelName` render sane output.
 * Nothing here is a real note on disk.
 */

export interface Prompt {
  title: string;
  body: string;
  model?: string;
  tags: string[];
}

export interface IdeaBubble {
  heading: string;
  body: string;
  model: string;
}

export interface IdeaNote {
  title: string;
  bubbles: IdeaBubble[];
}

export interface Collection {
  name: string;
  prompts: Prompt[];
}

/** A slice of the catalog the app fetches at runtime, shaped like `ModelInfo`
 *  in app/src/api.ts. Notes store the `id`; every preview renders `name`
 *  through `shortModelName`, exactly as ModelPicker does — without this the
 *  chips would read "claude-opus-5" instead of "Opus 5". */
export interface CatalogModel {
  id: string;
  provider: string;
  name: string;
  /** Context window in tokens. */
  context: number;
  reasoning: boolean;
  vision: boolean;
}

export const modelCatalog: CatalogModel[] = [
  {
    id: "anthropic/claude-opus-5",
    provider: "anthropic",
    name: "Claude Opus 5",
    context: 200_000,
    reasoning: true,
    vision: true,
  },
  {
    id: "google/gemini-3-pro",
    provider: "google",
    name: "Gemini 3 Pro",
    context: 1_000_000,
    reasoning: true,
    vision: true,
  },
  {
    id: "deepseek/deepseek-v4",
    provider: "deepseek",
    name: "DeepSeek V4",
    context: 128_000,
    reasoning: true,
    vision: false,
  },
  {
    id: "anthropic/claude-haiku-4-5",
    provider: "anthropic",
    name: "Claude Haiku 4.5",
    context: 200_000,
    reasoning: false,
    vision: true,
  },
];

/** The catalog entry for a model id, or a stand-in when it is not listed —
 *  the same fallback ModelPicker makes for an id it cannot resolve. */
export function modelInfo(id: string): CatalogModel {
  const found = modelCatalog.find((model) => model.id === id);
  if (found) return found;
  return { id, provider: id.split("/")[0], name: id, context: 0, reasoning: false, vision: false };
}

export const collections: Collection[] = [
  {
    name: "Shipper prompts",
    prompts: [
      {
        title: "Pre-mortem",
        body: "Assume this launch failed six months from now. List the five most likely reasons, the earliest warning sign for each, and one action we can take before launch.",
        model: "anthropic/claude-opus-5",
        tags: ["strategy", "risk"],
      },
      {
        title: "Differentiation",
        body: "Compare this product with the three alternatives users choose today. Name one defensible advantage, what it costs us, and the proof a skeptical buyer would need.",
        model: "deepseek/deepseek-v4",
        tags: ["strategy", "positioning"],
      },
      {
        title: "Design",
        body: "Review this screen against the user's primary job. Identify the strongest hierarchy problem, the interaction most likely to confuse, and the smallest change that fixes each.",
        model: "google/gemini-3-pro",
        tags: ["design", "review"],
      },
      {
        title: "SEO",
        body: "Turn this topic into a search brief: intent, primary query, supporting questions, title, outline, internal links, and what the current top results leave unanswered.",
        model: "deepseek/deepseek-v4",
        tags: ["marketing", "seo"],
      },
    ],
  },
  {
    name: "Reviewer prompts",
    prompts: [
      {
        title: "First pass on a diff",
        body: "Only flag what is wrong, not what is different from your taste. For each finding: the line, what breaks, and the input that breaks it.",
        model: "anthropic/claude-opus-5",
        tags: ["review"],
      },
      {
        title: "Find the missing tests",
        body: "List the branches this change adds that no test reaches. Order by how quietly they would fail in production.",
        model: "deepseek/deepseek-v4",
        tags: ["testing"],
      },
      {
        title: "Read it as an attacker",
        body: "Assume every input is hostile. Name the reachable ones, and for each say what you would send.",
        model: "google/gemini-3-pro",
        tags: ["security"],
      },
    ],
  },
  {
    name: "Explainer prompts",
    prompts: [
      {
        title: "Explain this stack trace",
        body: "Name the frame where it actually went wrong — not the one that threw — and say what state made it possible.",
        model: "deepseek/deepseek-v4",
        tags: ["debugging"],
      },
      {
        title: "Explain it to the new hire",
        body: "Describe what this module is for in five sentences, with no jargon that is not defined in the repository.",
        model: "anthropic/claude-opus-5",
        tags: ["docs"],
      },
    ],
  },
];

/** Loose prompts that belong to no bucket. */
export const loosePrompts: Prompt[] = [
  {
    title: "Commit message voice",
    body: "Imperative mood, lowercase subject, under 60 characters. The body says why, never what.",
    tags: ["git"],
  },
  {
    title: "Name this thing",
    body: "Give ten names. No portmanteaus, no dropped vowels, nothing that needs the domain to be explained.",
    model: "deepseek/deepseek-v4",
    tags: ["naming"],
  },
];

export const ideas: IdeaNote[] = [
  {
    title: "Quantum Calculator",
    bubbles: [
      {
        heading: "The pitch",
        body: "A calculator for quantum circuits that explains what it computed — no black box, every answer walked through.",
        model: "anthropic/claude-opus-5",
      },
      {
        heading: "What it actually is",
        body: "A circuit editor, a simulator backend, and a \"why this answer\" pane that steps through each gate.",
        model: "deepseek/deepseek-v4",
      },
      {
        heading: "Open question: sharing",
        body: "Save circuits as JSON files in the vault, or keep a per-project copy alongside the code?",
        model: "google/gemini-3-pro",
      },
    ],
  },
  {
    title: "AI Fridge",
    bubbles: [
      {
        heading: "What the camera sees",
        body: "A $40 wide-angle cam on the shelf. It photographs the contents on open and tags each shelf with a freshness guess.",
        model: "deepseek/deepseek-v4",
      },
      {
        heading: "The shelf-life model",
        body: "Not expiration dates — a decay curve per category, learned from what actually gets thrown out.",
        model: "anthropic/claude-opus-5",
      },
      {
        heading: "Open question: power budget",
        body: "A Pi Zero runs 24/7 on 1.2W. Can the vision model fit, or does the tagging happen on a phone?",
        model: "google/gemini-3-pro",
      },
    ],
  },
  {
    title: "Recipe Scanner",
    bubbles: [
      {
        heading: "Scan a page, get a recipe",
        body: "Photograph any cookbook page and the ingredients come back as a list you can shop from.",
        model: "deepseek/deepseek-v4",
      },
      {
        heading: "Where the hard part is",
        body: "Not the OCR — the units. UK cups and US cups differ by 12%, and no cookbook says which it means.",
        model: "anthropic/claude-opus-5",
      },
      {
        heading: "Open question: units",
        body: "Normalize everything to metric, or keep the original and annotate it?",
        model: "google/gemini-3-pro",
      },
    ],
  },
  {
    title: "Sleep Coach",
    bubbles: [
      {
        heading: "One change at a time",
        body: "The coach suggests a single experiment per night, never a routine overhaul — so the cause is attributable.",
        model: "anthropic/claude-opus-5",
      },
      {
        heading: "The scoring rule",
        body: "60% consistency, 30% total time, 10% how rested you say you feel. No wearables needed.",
        model: "deepseek/deepseek-v4",
      },
      {
        heading: "Open question: escalation",
        body: "If three experiments in a row fail, should it suggest a doctor — or stay silent?",
        model: "google/gemini-3-pro",
      },
    ],
  },
  {
    title: "Trail Finder",
    bubbles: [
      {
        heading: "Ranked by profile",
        body: "Not by distance — by how much of the climb is front-loaded. A gentle start beats a wall at mile one.",
        model: "deepseek/deepseek-v4",
      },
      {
        heading: "The turn list",
        body: "GPX waypoints become left/right directions with named landmarks, readable without the map open.",
        model: "anthropic/claude-opus-5",
      },
      {
        heading: "Open question: offline",
        body: "Tiles are heavy. Ship vector contours only, or let the phone cache a 5 km radius?",
        model: "google/gemini-3-pro",
      },
    ],
  },
];

export const vaultPath = "~/vault";
