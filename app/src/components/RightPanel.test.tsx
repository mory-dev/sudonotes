import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useStore } from "../store";
import { RightPanel } from "./RightPanel";
import { setCachedIdeaBubbles } from "../useLinkedIdeaBubbles";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("RightPanel Prompt Template Variables & Idea Bubbles Autocompletion", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    setCachedIdeaBubbles("idea-1", "2026-08-01T00:00:00Z", [
      {
        id: "idea-1-bubble-0",
        noteId: "idea-1",
        noteTitle: "Offline Alert Idea",
        label: "Offline alert queue",
        sanitized: "offline_alert_queue",
        content: "Store sensor alerts while the network is unavailable.",
        rawText: "## Offline alert queue\nStore sensor alerts while the network is unavailable.",
      },
      {
        id: "idea-1-bubble-1",
        noteId: "idea-1",
        noteTitle: "Offline Alert Idea",
        label: "Target audience",
        sanitized: "target_audience",
        content: "Embedded engineers.",
        rawText: "Target audience\nEmbedded engineers.",
      },
    ]);

    useStore.setState({
      active: {
        id: "prompt-1",
        title: "Test Template Prompt",
        body: "Prompt context: {{offline_alert_queue}} for {{target_audience}} and {{custom_var}}.\nSee [[Offline Alert Idea]] for details.",
        tags: ["template"],
        type: "prompt",
        created: "2026-08-01T00:00:00Z",
        updated: "2026-08-01T00:00:00Z",
        path: "Test Template Prompt.md",
        summary: null,
        icon: null,
        collection: null,
        position: null,
        models: {},
        model: null,
        bubbleTags: {},
        project: null,
        onHold: false,
      },
      notes: [
        {
          id: "idea-1",
          title: "Offline Alert Idea",
          type: "idea",
          tags: ["ideas"],
          collection: null,
          summary: null,
          updated: "2026-08-01T00:00:00Z",
          onHold: false,
        },
      ],
      backlinks: [],
      hoverPrompt: null,
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders variables list and badges for matched idea bubbles", async () => {
    await act(async () => {
      root.render(<RightPanel />);
    });

    const varsSection = container.querySelector(".panel-section.variables");
    expect(varsSection).not.toBeNull();

    const varRows = container.querySelectorAll(".variable-list li");
    expect(varRows).toHaveLength(3);

    const names = Array.from(container.querySelectorAll(".variable-name")).map(
      (el) => el.textContent,
    );
    expect(names).toEqual(["offline_alert_queue", "target_audience", "custom_var"]);

    // Badges indicate linked idea bubbles
    const badges = container.querySelectorAll(".variable-preview-badge");
    expect(badges.length).toBeGreaterThanOrEqual(2);
    expect(badges[0].textContent).toContain("Offline alert queue");
    expect(badges[1].textContent).toContain("Target audience");
  });

  it("triggers autocomplete popup when typing {{ in a variable input", async () => {
    await act(async () => {
      root.render(<RightPanel />);
    });

    const input = container.querySelector<HTMLInputElement>("#var-custom_var");
    expect(input).not.toBeNull();

    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(input, "{{off");
      input!.selectionStart = 5;
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      input!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Verify autocomplete popup appears
    const popup = container.querySelector(".variable-autocomplete-popup");
    expect(popup).not.toBeNull();
    expect(popup?.textContent).toContain("offline_alert_queue");
  });

  it("toggles preview substitution displaying filled prompt text", async () => {
    await act(async () => {
      root.render(<RightPanel />);
    });

    const previewToggle = container.querySelector<HTMLButtonElement>(".variable-preview-toggle");
    expect(previewToggle).not.toBeNull();

    await act(async () => {
      previewToggle!.click();
    });

    const previewBox = container.querySelector(".variables-preview-box");
    expect(previewBox).not.toBeNull();
    expect(previewBox?.textContent).toContain("Store sensor alerts while the network is unavailable.");
    expect(previewBox?.textContent).toContain("Embedded engineers.");
    expect(previewBox?.textContent).toContain("{{custom_var}}");
  });
});
