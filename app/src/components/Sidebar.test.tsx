import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, nextIdeaMark, normalizeIdeaMark, type NoteMeta } from "../api";
import { useStore } from "../store";
import { IdeaHoldToggle, Sidebar } from "./Sidebar";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

describe("normalizeIdeaMark and nextIdeaMark", () => {
  it("normalizes falsy and off values to 'off'", () => {
    expect(normalizeIdeaMark(undefined)).toBe("off");
    expect(normalizeIdeaMark(null)).toBe("off");
    expect(normalizeIdeaMark(false)).toBe("off");
    expect(normalizeIdeaMark("")).toBe("off");
    expect(normalizeIdeaMark("off")).toBe("off");
    expect(normalizeIdeaMark("unknown")).toBe("off");
  });

  it("normalizes boolean true, 'on', and 'orange' to 'orange' for backward compatibility", () => {
    expect(normalizeIdeaMark(true)).toBe("orange");
    expect(normalizeIdeaMark("on")).toBe("orange");
    expect(normalizeIdeaMark("orange")).toBe("orange");
  });

  it("normalizes 'green' to 'green'", () => {
    expect(normalizeIdeaMark("green")).toBe("green");
  });

  it("cycles strictly: off -> orange -> green -> off", () => {
    expect(nextIdeaMark("off")).toBe("orange");
    expect(nextIdeaMark(false)).toBe("orange");
    expect(nextIdeaMark(undefined)).toBe("orange");

    expect(nextIdeaMark("orange")).toBe("green");
    expect(nextIdeaMark(true)).toBe("green");

    expect(nextIdeaMark("green")).toBe("off");
  });
});

describe("IdeaHoldToggle component", () => {
  let container: HTMLDivElement;
  let root: Root;

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
    vi.restoreAllMocks();
  });

  const baseNote: NoteMeta = {
    id: "01TESTNOTEID",
    title: "Project Redesign",
    type: "idea",
    tags: ["design"],
    collection: null,
    summary: "Refactor sidebar",
    updated: "2026-09-01T00:00:00Z",
    mark: "off",
  };

  it("renders the unmarked (off) state with correct terminology and accessibility attributes", () => {
    act(() => {
      root.render(<IdeaHoldToggle note={{ ...baseNote, mark: "off" }} />);
    });

    const button = container.querySelector("button")!;
    expect(button).toBeDefined();
    expect(button.getAttribute("data-state")).toBe("off");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.getAttribute("aria-label")).toBe("Mark Project Redesign");
    expect(button.getAttribute("data-tooltip")).toBe("Click to mark");
    expect(button.className).toContain("state-off");
    expect(button.className).not.toContain("on");

    const orb = button.querySelector(".idea-hold-orb")!;
    expect(orb.className).toContain("orb-off");
  });

  it("renders the orange (in progress / marked) state", () => {
    act(() => {
      root.render(<IdeaHoldToggle note={{ ...baseNote, mark: "orange" }} />);
    });

    const button = container.querySelector("button")!;
    expect(button.getAttribute("data-state")).toBe("orange");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("Cycle mark for Project Redesign");
    expect(button.getAttribute("data-tooltip")).toBe("In progress · Click to cycle");
    expect(button.className).toContain("state-orange");
    expect(button.className).toContain("on");

    const orb = button.querySelector(".idea-hold-orb")!;
    expect(orb.className).toContain("orb-orange");
  });

  it("renders the green (active / complete) state", () => {
    act(() => {
      root.render(<IdeaHoldToggle note={{ ...baseNote, mark: "green" }} />);
    });

    const button = container.querySelector("button")!;
    expect(button.getAttribute("data-state")).toBe("green");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("Unmark Project Redesign");
    expect(button.getAttribute("data-tooltip")).toBe("Complete · Click to unmark");
    expect(button.className).toContain("state-green");
    expect(button.className).toContain("on");

    const orb = button.querySelector(".idea-hold-orb")!;
    expect(orb.className).toContain("orb-green");
  });

  it("supports legacy boolean mark (true -> orange, false -> off)", () => {
    act(() => {
      root.render(<IdeaHoldToggle note={{ ...baseNote, mark: true }} />);
    });
    let button = container.querySelector("button")!;
    expect(button.getAttribute("data-state")).toBe("orange");
    expect(button.getAttribute("aria-label")).toBe("Cycle mark for Project Redesign");

    act(() => {
      root.render(<IdeaHoldToggle note={{ ...baseNote, mark: false }} />);
    });
    button = container.querySelector("button")!;
    expect(button.getAttribute("data-state")).toBe("off");
    expect(button.getAttribute("aria-label")).toBe("Mark Project Redesign");
  });

  it("calls setNoteMark with next state on click: off -> orange", () => {
    const spy = vi.spyOn(api, "setNoteMark").mockResolvedValue();

    act(() => {
      root.render(<IdeaHoldToggle note={{ ...baseNote, mark: "off" }} />);
    });

    const button = container.querySelector("button")!;
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(spy).toHaveBeenCalledWith("01TESTNOTEID", "orange");
  });

  it("calls setNoteMark with next state on click: orange -> green", () => {
    const spy = vi.spyOn(api, "setNoteMark").mockResolvedValue();

    act(() => {
      root.render(<IdeaHoldToggle note={{ ...baseNote, mark: "orange" }} />);
    });

    const button = container.querySelector("button")!;
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(spy).toHaveBeenCalledWith("01TESTNOTEID", "green");
  });

  it("calls setNoteMark with next state on click: green -> off", () => {
    const spy = vi.spyOn(api, "setNoteMark").mockResolvedValue();

    act(() => {
      root.render(<IdeaHoldToggle note={{ ...baseNote, mark: "green" }} />);
    });

    const button = container.querySelector("button")!;
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(spy).toHaveBeenCalledWith("01TESTNOTEID", "off");
  });

  it("stops click and pointerdown propagation so parent row is not activated", () => {
    const parentClickSpy = vi.fn();
    const parentPointerSpy = vi.fn();
    vi.spyOn(api, "setNoteMark").mockResolvedValue();

    act(() => {
      root.render(
        <div onClick={parentClickSpy} onPointerDown={parentPointerSpy}>
          <IdeaHoldToggle note={baseNote} />
        </div>,
      );
    });

    const button = container.querySelector("button")!;
    act(() => {
      button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(parentClickSpy).not.toHaveBeenCalled();
    expect(parentPointerSpy).not.toHaveBeenCalled();
  });
});

describe("Sidebar integration with 3-state idea marking", () => {
  let container: HTMLDivElement;
  let root: Root;

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
    vi.restoreAllMocks();
  });

  it("renders idea rows with IdeaHoldToggle and prompts without it", () => {
    useStore.setState({
      notes: [
        {
          id: "prompt-1",
          title: "A Prompt",
          type: "prompt",
          tags: [],
          collection: null,
          summary: null,
          updated: "2026-09-01T00:00:00Z",
        },
        {
          id: "idea-1",
          title: "First Idea",
          type: "idea",
          tags: [],
          collection: null,
          summary: null,
          updated: "2026-09-01T00:00:00Z",
          mark: "orange",
        },
        {
          id: "idea-2",
          title: "Second Idea",
          type: "idea",
          tags: [],
          collection: null,
          summary: null,
          updated: "2026-09-01T00:00:00Z",
          mark: "green",
        },
      ],
      active: null,
    });

    act(() => {
      root.render(<Sidebar />);
    });

    const promptBtn = container.querySelector('[data-note-id="prompt-1"]')!;
    expect(promptBtn.parentElement?.querySelector(".idea-hold-toggle")).toBeNull();

    const ideaBtn1 = container.querySelector('[data-note-id="idea-1"]')!;
    const toggle1 = ideaBtn1.parentElement?.querySelector(".idea-hold-toggle")!;
    expect(toggle1).toBeDefined();
    expect(toggle1.getAttribute("data-state")).toBe("orange");

    const ideaBtn2 = container.querySelector('[data-note-id="idea-2"]')!;
    const toggle2 = ideaBtn2.parentElement?.querySelector(".idea-hold-toggle")!;
    expect(toggle2).toBeDefined();
    expect(toggle2.getAttribute("data-state")).toBe("green");
  });
});

describe("Store setNoteMark integration", () => {
  it("persists mark state changes through api and updates store state", async () => {
    const mockSetNoteOnHold = vi.spyOn(api, "setNoteMark").mockResolvedValue();
    const mockListNotes = vi.spyOn(api, "listNotes").mockResolvedValue([]);

    useStore.setState({
      notes: [
        {
          id: "note-1",
          title: "My Idea",
          type: "idea",
          tags: [],
          collection: null,
          summary: null,
          updated: "2026-09-01T00:00:00Z",
          mark: "off",
        },
      ],
      active: {
        baseHash: "",
        id: "note-1",
        title: "My Idea",
        type: "idea",
        tags: [],
        collection: null,
        summary: null,
        updated: "2026-09-01T00:00:00Z",
        mark: "off",
        model: null,
        position: null,
        project: null,
        models: {},
        bubbleTags: {},
        bubbleIssues: {},
        issueStates: {},
        remote: null,
        created: "2026-09-01T00:00:00Z",
        body: "First bubble",
        path: "ideas/My Idea.md",
      },
    });

    // 1. Cycle to orange
    await useStore.getState().setNoteMark("note-1", "orange");
    expect(mockSetNoteOnHold).toHaveBeenCalledWith("note-1", "orange");
    expect(useStore.getState().active?.mark).toBe("orange");

    // 2. Cycle to green
    await useStore.getState().setNoteMark("note-1", "green");
    expect(mockSetNoteOnHold).toHaveBeenCalledWith("note-1", "green");
    expect(useStore.getState().active?.mark).toBe("green");

    // 3. Cycle to off
    await useStore.getState().setNoteMark("note-1", "off");
    expect(mockSetNoteOnHold).toHaveBeenCalledWith("note-1", "off");
    expect(useStore.getState().active?.mark).toBe("off");

    mockSetNoteOnHold.mockRestore();
    mockListNotes.mockRestore();
  });
});
