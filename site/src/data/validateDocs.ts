import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import type { DocEntry } from "./docs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function validateDocs(docs: DocEntry[]): void {
  const ids = new Set(docs.map((entry) => entry.id));
  const positions = new Set<string>();

  for (const entry of docs) {
    const position = `${entry.data.section}:${entry.data.order}`;
    if (positions.has(position)) {
      throw new Error(`Duplicate documentation position ${position}`);
    }
    positions.add(position);

    for (const related of entry.data.related) {
      if (!ids.has(related)) {
        throw new Error(`${entry.id} links to missing related guide ${related}`);
      }
    }

    for (const source of entry.data.sources) {
      const absolute = resolve(REPOSITORY_ROOT, source);
      if (!existsSync(absolute)) {
        throw new Error(`${entry.id} cites missing source ${source}`);
      }
    }
  }
}
