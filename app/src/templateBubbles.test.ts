import { describe, expect, it } from "vitest";
import {
  bubbleBodyText,
  bubbleFirstText,
  extractIdeaBubbles,
  findMatchingBubble,
  getLinkedIdeaTitles,
  getTemplateVariableAutocompleteState,
  insertTemplateVariable,
  placeholdersIn,
  sanitizeBubbleVarName,
  substituteTemplateVariables,
} from "./templateBubbles";

describe("sanitizeBubbleVarName", () => {
  it("converts spaces and hyphens to snake_case", () => {
    expect(sanitizeBubbleVarName("Offline Alert Queue")).toBe("offline_alert_queue");
    expect(sanitizeBubbleVarName("offline-alert-queue")).toBe("offline_alert_queue");
  });

  it("strips markdown headings and symbols while preserving underscores", () => {
    expect(sanitizeBubbleVarName("## Target User (Primary)")).toBe("target_user_primary");
    expect(sanitizeBubbleVarName("# **Critical Requirements**")).toBe("critical_requirements");
    expect(sanitizeBubbleVarName("`code_identifier`")).toBe("code_identifier");
  });

  it("handles empty or symbol-only inputs", () => {
    expect(sanitizeBubbleVarName("### ")).toBe("variable");
    expect(sanitizeBubbleVarName("***")).toBe("variable");
  });
});

describe("bubbleFirstText & bubbleBodyText", () => {
  it("extracts the first line as label without heading marks", () => {
    const raw = "## Architecture Plan\nThis describes the backend flow.\n- Step 1\n- Step 2";
    expect(bubbleFirstText(raw)).toBe("Architecture Plan");
    expect(bubbleBodyText(raw)).toBe("This describes the backend flow.\n- Step 1\n- Step 2");
  });

  it("handles single-line bubbles", () => {
    const raw = "Simple task bubble";
    expect(bubbleFirstText(raw)).toBe("Simple task bubble");
    expect(bubbleBodyText(raw)).toBe("Simple task bubble");
  });

  it("skips bubble marker comments", () => {
    const raw = "<!-- bubble -->\n# Nested Idea\nContent inside marker\n<!-- /bubble -->";
    expect(bubbleFirstText(raw)).toBe("Nested Idea");
    expect(bubbleBodyText(raw)).toBe("Content inside marker");
  });
});

describe("extractIdeaBubbles", () => {
  it("extracts blank-line separated bubbles from idea markdown", () => {
    const body = `
# Offline alert queue
Store sensor alerts while the network is unavailable.

Preserve the original timestamp and retry in order.

Keep the queue bounded and make overflow visible.
`.trim();

    const bubbles = extractIdeaBubbles(body, "Offline Alert Idea", "idea-1");
    expect(bubbles).toHaveLength(3);

    expect(bubbles[0].label).toBe("Offline alert queue");
    expect(bubbles[0].sanitized).toBe("offline_alert_queue");
    expect(bubbles[0].content).toBe("Store sensor alerts while the network is unavailable.");
    expect(bubbles[0].noteTitle).toBe("Offline Alert Idea");

    expect(bubbles[1].label).toBe("Preserve the original timestamp and retry in order.");
    expect(bubbles[1].sanitized).toBe("preserve_the_original_timestamp_and_retry_in_order");

    expect(bubbles[2].label).toBe("Keep the queue bounded and make overflow visible.");
  });

  it("extracts explicit <!-- bubble --> marker pairs", () => {
    const body = `
Intro text here

<!-- bubble -->
## Multi line bubble
Line 1

Line 2 inside same bubble
<!-- /bubble -->

Trailing thought
`.trim();

    const bubbles = extractIdeaBubbles(body, "Markers Note", "idea-2");
    expect(bubbles).toHaveLength(3);
    expect(bubbles[1].label).toBe("Multi line bubble");
    expect(bubbles[1].sanitized).toBe("multi_line_bubble");
    expect(bubbles[1].content).toContain("Line 1\n\nLine 2 inside same bubble");
  });

  it("returns empty array for empty bodies", () => {
    expect(extractIdeaBubbles("")).toEqual([]);
    expect(extractIdeaBubbles("   \n\n  ")).toEqual([]);
  });
});

describe("placeholdersIn", () => {
  it("finds all distinct placeholders in order of appearance", () => {
    const text = "Hello {{user_name}}, welcome to {{ app_name }}! Contact {{user_name}} for help.";
    expect(placeholdersIn(text)).toEqual(["user_name", "app_name"]);
  });

  it("returns empty array when no placeholders are present", () => {
    expect(placeholdersIn("Plain text prompt without placeholders")).toEqual([]);
  });
});

describe("getLinkedIdeaTitles", () => {
  it("extracts wikilinks and idea backlinks", () => {
    const prompt = "Use context from [[Offline Alerts]] and [[System Architecture|Arch]] in this prompt.";
    const backlinks = [
      { title: "Project Roadmap", type: "idea" },
      { title: "Other Prompt", type: "prompt" },
    ];
    const linked = getLinkedIdeaTitles(prompt, backlinks);
    expect(linked).toContain("Offline Alerts");
    expect(linked).toContain("System Architecture");
    expect(linked).toContain("Project Roadmap");
    expect(linked).not.toContain("Other Prompt");
  });
});

describe("getTemplateVariableAutocompleteState", () => {
  it("detects active trigger when typing {{ at end of string", () => {
    const text = "Create a summary of {{";
    const state = getTemplateVariableAutocompleteState(text, text.length);
    expect(state).not.toBeNull();
    expect(state?.isOpen).toBe(true);
    expect(state?.query).toBe("");
    expect(state?.from).toBe(20);
    expect(state?.to).toBe(22);
  });

  it("detects trigger with query while typing variable name", () => {
    const text = "Prompt with {{target_";
    const state = getTemplateVariableAutocompleteState(text, text.length);
    expect(state?.isOpen).toBe(true);
    expect(state?.query).toBe("target_");
    expect(state?.from).toBe(12);
  });

  it("handles cursor inside existing unclosed or half-typed tag", () => {
    const text = "Prompt with {{target_aud}} and more text";
    const cursorPos = text.indexOf("target_aud") + "target_aud".length; // right after target_aud
    const state = getTemplateVariableAutocompleteState(text, cursorPos);
    expect(state?.isOpen).toBe(true);
    expect(state?.query).toBe("target_aud");
    expect(state?.from).toBe(12);
    expect(state?.to).toBe(26); // encompasses }}
  });

  it("returns null when cursor is outside variable tag", () => {
    const text = "Prompt with {{closed_var}} normal text";
    const state = getTemplateVariableAutocompleteState(text, 30);
    expect(state).toBeNull();
  });

  it("returns null when {{ is separated by a newline", () => {
    const text = "Prompt with {{\nsome multi\nline";
    const state = getTemplateVariableAutocompleteState(text, text.length);
    expect(state).toBeNull();
  });
});

describe("insertTemplateVariable", () => {
  it("inserts variable tag at trigger position", () => {
    const text = "Generate code for {{off";
    const result = insertTemplateVariable(text, text.length, "offline_queue");
    expect(result.newText).toBe("Generate code for {{offline_queue}}");
    expect(result.newCursorPos).toBe("Generate code for {{offline_queue}}".length);
  });

  it("replaces existing unclosed or closing brackets cleanly", () => {
    const text = "Use {{var}} in this step";
    const result = insertTemplateVariable(text, 7, "target_audience");
    expect(result.newText).toBe("Use {{target_audience}} in this step");
  });

  it("can insert as bare variable name when asTag is false", () => {
    const text = "value: {{off";
    const result = insertTemplateVariable(text, text.length, "offline_queue", false);
    expect(result.newText).toBe("value: offline_queue");
  });
});

describe("findMatchingBubble & substituteTemplateVariables", () => {
  const bubbles = [
    {
      label: "Offline alert queue",
      sanitized: "offline_alert_queue",
      content: "Store sensor alerts while network is unavailable.",
      rawText: "## Offline alert queue\nStore sensor alerts while network is unavailable.",
    },
    {
      label: "Target audience",
      sanitized: "target_audience",
      content: "Embedded systems engineers.",
      rawText: "Target audience\nEmbedded systems engineers.",
    },
  ];

  it("finds matching bubble by sanitized name or label", () => {
    expect(findMatchingBubble("offline_alert_queue", bubbles)?.label).toBe("Offline alert queue");
    expect(findMatchingBubble("Target audience", bubbles)?.sanitized).toBe("target_audience");
  });

  it("substitutes template variables using matching bubble content", () => {
    const template = "Context: {{offline_alert_queue}}\nAudience: {{target_audience}}\nOther: {{unknown_var}}";
    const substituted = substituteTemplateVariables(template, bubbles);

    expect(substituted).toContain("Context: Store sensor alerts while network is unavailable.");
    expect(substituted).toContain("Audience: Embedded systems engineers.");
    expect(substituted).toContain("Other: {{unknown_var}}");
  });

  it("allows user-specified values to override bubble content", () => {
    const template = "Audience: {{target_audience}}";
    const substituted = substituteTemplateVariables(template, bubbles, {
      target_audience: "Web developers",
    });
    expect(substituted).toBe("Audience: Web developers");
  });
});
