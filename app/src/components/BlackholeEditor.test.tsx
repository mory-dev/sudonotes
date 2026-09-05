import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStore } from "../store";
import { BlackholeEditor } from "./BlackholeEditor";

describe("BlackholeEditor empty landing", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useStore.setState({
      blackholeOpen: true,
      blackholeBody: "",
      dirty: false,
      find: null,
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    useStore.setState({ blackholeOpen: false, blackholeBody: "", find: null });
    vi.restoreAllMocks();
  });

  it("shows the dump landing only while the blackhole is empty", () => {
    act(() => {
      root.render(<BlackholeEditor />);
    });

    expect(container.querySelector("[data-blackhole-empty]")).toBeTruthy();
    expect(container.textContent).toContain("A dump for everything else");
    expect(container.textContent).toContain("Start dumping");
  });

  it("hides the landing after starting", () => {
    act(() => {
      root.render(<BlackholeEditor />);
    });

    const start = container.querySelector(".blank-blackhole") as HTMLButtonElement;
    act(() => {
      start.click();
    });
    expect(container.querySelector("[data-blackhole-empty]")).toBeNull();
  });

  it("skips the landing when the dump already has text", () => {
    useStore.setState({ blackholeBody: "already dumped" });
    act(() => {
      root.render(<BlackholeEditor />);
    });
    expect(container.querySelector("[data-blackhole-empty]")).toBeNull();
  });
});
