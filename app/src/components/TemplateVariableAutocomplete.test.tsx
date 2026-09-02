import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TemplateVariableAutocomplete } from "./TemplateVariableAutocomplete";
import { type IdeaBubble } from "../templateBubbles";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("TemplateVariableAutocomplete", () => {
  let container: HTMLDivElement;
  let root: Root;

  const mockBubbles: IdeaBubble[] = [
    {
      id: "b-1",
      label: "Offline alert queue",
      sanitized: "offline_alert_queue",
      content: "Store sensor alerts while offline.",
      rawText: "## Offline alert queue\nStore sensor alerts while offline.",
      noteTitle: "Offline Alerts Idea",
    },
    {
      id: "b-2",
      label: "Target audience",
      sanitized: "target_audience",
      content: "Embedded engineers.",
      rawText: "Target audience\nEmbedded engineers.",
      noteTitle: "Audience Notes",
    },
  ];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders list of bubbles with sanitized variable tags and labels", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <TemplateVariableAutocomplete
          bubbles={mockBubbles}
          query=""
          onSelect={onSelect}
          onClose={onClose}
        />,
      );
    });

    const items = container.querySelectorAll(".var-auto-item");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("{{offline_alert_queue}}");
    expect(items[0].textContent).toContain("Offline alert queue");
    expect(items[0].textContent).toContain("Offline Alerts Idea");

    expect(items[1].textContent).toContain("{{target_audience}}");
  });

  it("filters bubbles matching query", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <TemplateVariableAutocomplete
          bubbles={mockBubbles}
          query="target"
          onSelect={onSelect}
          onClose={onClose}
        />,
      );
    });

    const items = container.querySelectorAll(".var-auto-item");
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain("{{target_audience}}");
  });

  it("calls onSelect when a bubble is clicked", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <TemplateVariableAutocomplete
          bubbles={mockBubbles}
          query=""
          onSelect={onSelect}
          onClose={onClose}
        />,
      );
    });

    const items = container.querySelectorAll<HTMLButtonElement>(".var-auto-item");
    act(() => {
      items[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(onSelect).toHaveBeenCalledWith(mockBubbles[0]);
  });

  it("shows empty message when no bubbles match", async () => {
    await act(async () => {
      root.render(
        <TemplateVariableAutocomplete
          bubbles={mockBubbles}
          query="nonexistent"
          onSelect={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });

    const empty = container.querySelector(".var-auto-empty");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain("No bubble matching");
  });
});
