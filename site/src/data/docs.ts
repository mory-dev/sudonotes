import type { CollectionEntry } from "astro:content";

export type DocEntry = CollectionEntry<"docs">;

export const DOC_SECTIONS = [
  {
    id: "start",
    label: "Start here",
    description: "Set up a vault and learn the everyday workflow.",
  },
  {
    id: "write",
    label: "Write and organize",
    description: "Capture reusable prompts and connect the ideas behind them.",
  },
  {
    id: "find",
    label: "Find and navigate",
    description: "Move through a vault quickly with search, links, and the keyboard.",
  },
  {
    id: "projects",
    label: "Projects and LLMs",
    description: "Keep project ideas beside the code where local agents can use them.",
  },
  {
    id: "data",
    label: "Data and safety",
    description: "Understand the files you own, backups, recovery, and privacy.",
  },
  {
    id: "reference",
    label: "Reference and help",
    description: "Exact formats, settings, limitations, and troubleshooting.",
  },
] as const;

export type DocSectionId = (typeof DOC_SECTIONS)[number]["id"];

export function docHref(id: string): string {
  return `/docs/${id.replace(/\/index$/, "")}`;
}

export function docsInOrder(docs: DocEntry[]): DocEntry[] {
  const sectionOrder = new Map(DOC_SECTIONS.map((section, index) => [section.id, index]));
  return [...docs].sort((a, b) => {
    const bySection =
      (sectionOrder.get(a.data.section) ?? 999) - (sectionOrder.get(b.data.section) ?? 999);
    return bySection || a.data.order - b.data.order || a.data.title.localeCompare(b.data.title);
  });
}

export function sectionLabel(id: string): string {
  return DOC_SECTIONS.find((section) => section.id === id)?.label ?? "Docs";
}
