import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useStore } from "../store";
import { PromptCards } from "./PromptCards";
import {
  clampPromptHeight,
  loadPromptHeights,
  MAX_PROMPT_HEIGHT,
  MIN_PROMPT_HEIGHT,
  PROMPT_HEIGHTS_STORAGE_KEY,
  savePromptHeight,
} from "../promptHeightStorage";

// Silence React 19 act environment warning in tests
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PromptCards vertical resizing & persistence", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    useStore.setState({
      active: {
        id: "col-1",
        title: "Test Collection",
        body: "",
        tags: [],
        type: "prompt",
        created: "2026-08-01T00:00:00Z",
        updated: "2026-08-01T00:00:00Z",
        path: "Test Collection.md",
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
      children: [
        {
          id: "prompt-1",
          title: "Prompt One",
          body: "Line 1\nLine 2\nLine 3\nLine 4\nLine 5",
          tags: ["test"],
          model: null,
          position: 1,
        },
        {
          id: "prompt-2",
          title: "Prompt Two",
          body: "Another prompt body content",
          tags: [],
          model: "claude-3-5-sonnet",
          position: 2,
        },
      ],
      promptHeights: {},
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    localStorage.clear();
  });

  it("renders a vertical resize handle for each prompt card", async () => {
    await act(async () => {
      root.render(<PromptCards />);
    });

    const card1 = container.querySelector("#prompt-card-prompt-1");
    expect(card1).not.toBeNull();

    const handle = card1?.querySelector(".card-resize-handle");
    expect(handle).not.toBeNull();
    expect(handle?.getAttribute("aria-label")).toBe("Resize prompt vertically");
  });

  it("restores saved custom heights from localStorage/store on initial render", async () => {
    savePromptHeight("prompt-1", 340);
    useStore.setState({ promptHeights: loadPromptHeights() });

    await act(async () => {
      root.render(<PromptCards />);
    });

    const bodyEl = container.querySelector("#prompt-card-prompt-1 .card-body") as HTMLElement;
    expect(bodyEl).not.toBeNull();
    expect(bodyEl.style.height).toBe("340px");
    expect(bodyEl.style.maxHeight).toBe("340px");
  });

  it("persists height on vertical drag and enforces min/max clamping (70px - 700px)", async () => {
    await act(async () => {
      root.render(<PromptCards />);
    });

    const handle = container.querySelector("#prompt-card-prompt-1 .card-resize-handle") as HTMLElement;
    const bodyEl = container.querySelector("#prompt-card-prompt-1 .card-body") as HTMLElement;
    const startHeight = bodyEl.getBoundingClientRect().height;

    // Simulate pointerdown
    act(() => {
      handle.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientY: 100,
        }),
      );
    });

    // Simulate pointermove expanding height by +150px
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientY: 250,
        }),
      );
    });

    // Verify live height updated in DOM
    const expectedHeight = clampPromptHeight(startHeight + 150);
    expect(bodyEl.style.height).toBe(`${expectedHeight}px`);

    // Simulate pointerup to commit
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientY: 250,
        }),
      );
    });

    // Check store state and localStorage persistence
    const stateHeights = useStore.getState().promptHeights;
    expect(stateHeights["prompt-1"]).toBe(expectedHeight);

    const persisted = JSON.parse(localStorage.getItem(PROMPT_HEIGHTS_STORAGE_KEY) || "{}");
    expect(persisted["prompt-1"]).toBe(expectedHeight);
  });

  it("clamps resize to minimum 70px when dragged upwards excessively", async () => {
    await act(async () => {
      root.render(<PromptCards />);
    });

    const handle = container.querySelector("#prompt-card-prompt-1 .card-resize-handle") as HTMLElement;

    act(() => {
      handle.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientY: 300,
        }),
      );
    });

    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientY: 0,
        }),
      );
    });

    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientY: 0,
        }),
      );
    });

    expect(useStore.getState().promptHeights["prompt-1"]).toBe(MIN_PROMPT_HEIGHT);
  });

  it("clamps resize to maximum 700px when dragged downwards excessively", async () => {
    await act(async () => {
      root.render(<PromptCards />);
    });

    const handle = container.querySelector("#prompt-card-prompt-1 .card-resize-handle") as HTMLElement;

    act(() => {
      handle.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientY: 100,
        }),
      );
    });

    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientY: 1500,
        }),
      );
    });

    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientY: 1500,
        }),
      );
    });

    expect(useStore.getState().promptHeights["prompt-1"]).toBe(MAX_PROMPT_HEIGHT);
  });

  it("resets height to default on handle double-click", async () => {
    savePromptHeight("prompt-1", 400);
    useStore.setState({ promptHeights: loadPromptHeights() });

    await act(async () => {
      root.render(<PromptCards />);
    });

    const handle = container.querySelector("#prompt-card-prompt-1 .card-resize-handle") as HTMLElement;
    const bodyEl = container.querySelector("#prompt-card-prompt-1 .card-body") as HTMLElement;

    expect(bodyEl.style.height).toBe("400px");

    act(() => {
      handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    });

    expect(useStore.getState().promptHeights["prompt-1"]).toBeUndefined();
    expect(bodyEl.style.height).toBe("");
  });
});
