import { describe, expect, it } from "vitest";
import { bubbleRanges, titleFromFirstLine } from "./store";

describe("store directive header and bubble parsing", () => {
  it("ignores LLM directive header when extracting title", () => {
    const body = `<!--
  sudonotes: Project Idea Backlog (synced with sudonotes)
  - This file contains the project roadmap, ideas, and feature backlog.
  - Ideas are separated by blank lines or <!-- bubble --> tags.
  - Changes made to this file automatically sync into sudonotes.
-->

# Actual Title

First bubble content.`;

    expect(titleFromFirstLine(body)).toBe("Actual Title");
  });

  it("ignores LLM directive comment block when calculating bubble ranges", () => {
    const body = `<!--
  sudonotes: Project Idea Backlog (synced with sudonotes)
  - This file contains the project roadmap, ideas, and feature backlog.
  - Ideas are separated by blank lines or <!-- bubble --> tags.
  - Changes made to this file automatically sync into sudonotes.
-->

Bubble 1 line 1
Bubble 1 line 2

Bubble 2 line 1`;

    const ranges = bubbleRanges(body);
    expect(ranges).toHaveLength(2);
    const bubble1Text = body.slice(ranges[0].from, ranges[0].to);
    const bubble2Text = body.slice(ranges[1].from, ranges[1].to);
    expect(bubble1Text).toBe("Bubble 1 line 1\nBubble 1 line 2");
    expect(bubble2Text).toBe("Bubble 2 line 1");
  });
});
