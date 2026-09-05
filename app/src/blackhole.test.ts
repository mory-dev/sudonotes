import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, type NoteDetail } from "./api";
import { useStore } from "./store";

function note(id: string): NoteDetail {
  return {
    id,
    title: id,
    type: "idea",
    tags: [],
    collection: null,
    summary: null,
    updated: "2026-09-01T00:00:00Z",
    model: null,
    position: null,
    project: null,
    models: {},
    bubbleTags: {},
    bubbleIssues: {},
    issueStates: {},
    remote: null,
    created: "2026-09-01T00:00:00Z",
    body: "idea body",
    baseHash: "hash",
    path: `ideas/${id}.md`,
  };
}

describe("blackhole dump", () => {
  beforeEach(() => {
    useStore.getState().discardPendingSave();
    useStore.setState({
      vaultPath: "/vault",
      notes: [],
      active: null,
      blackholeOpen: false,
      blackholeBody: "",
      backlinks: [],
      children: [],
      dirty: false,
      error: null,
    });
  });

  afterEach(() => {
    useStore.getState().discardPendingSave();
    vi.restoreAllMocks();
  });

  it("opens the dump without creating an idea note", async () => {
    const read = vi.spyOn(api, "readBlackhole").mockResolvedValue("scratch");
    const list = vi.spyOn(api, "listNotes");

    await useStore.getState().openBlackhole();

    expect(read).toHaveBeenCalledOnce();
    expect(list).not.toHaveBeenCalled();
    expect(useStore.getState().blackholeOpen).toBe(true);
    expect(useStore.getState().blackholeBody).toBe("scratch");
    expect(useStore.getState().active).toBeNull();
    expect(useStore.getState().notes).toEqual([]);
  });

  it("writes the dump file on flush", async () => {
    const write = vi.spyOn(api, "writeBlackhole").mockResolvedValue();

    useStore.getState().queueBlackholeSave("hello dump");
    expect(useStore.getState().dirty).toBe(true);
    await useStore.getState().flushBlackhole();

    expect(write).toHaveBeenCalledWith("hello dump");
    expect(useStore.getState().dirty).toBe(false);
  });

  it("closes the dump when a note is selected", async () => {
    vi.spyOn(api, "writeBlackhole").mockResolvedValue();
    vi.spyOn(api, "readNote").mockResolvedValue(note("idea-1"));
    vi.spyOn(api, "backlinks").mockResolvedValue([]);
    vi.spyOn(api, "collectionChildren").mockResolvedValue([]);

    useStore.setState({ blackholeOpen: true, blackholeBody: "scratch" });
    useStore.getState().queueBlackholeSave("scratch kept");
    await useStore.getState().select("idea-1");

    expect(api.writeBlackhole).toHaveBeenCalledWith("scratch kept");
    expect(useStore.getState().blackholeOpen).toBe(false);
    expect(useStore.getState().blackholeBody).toBe("");
    expect(useStore.getState().active?.id).toBe("idea-1");
  });

  it("flushes and closes the dump when opening another vault", async () => {
    vi.spyOn(api, "writeBlackhole").mockResolvedValue();
    vi.spyOn(api, "openVault").mockResolvedValue("/other");
    vi.spyOn(api, "listNotes").mockResolvedValue([]);
    vi.spyOn(api, "getAiSettings").mockResolvedValue({
      enabled: true,
      showBubbleMetadata: true,
      configured: true,
    });

    useStore.setState({ blackholeOpen: true, blackholeBody: "keep me" });
    useStore.getState().queueBlackholeSave("keep me");
    await useStore.getState().openVault("/other");

    expect(api.writeBlackhole).toHaveBeenCalledWith("keep me");
    expect(useStore.getState().blackholeOpen).toBe(false);
    expect(useStore.getState().blackholeBody).toBe("");
    expect(useStore.getState().vaultPath).toBe("/other");
  });

  it("does not reopen the dump when it is already open", async () => {
    const read = vi.spyOn(api, "readBlackhole").mockResolvedValue("later");
    useStore.setState({ blackholeOpen: true, blackholeBody: "already here" });

    await useStore.getState().openBlackhole();

    expect(read).not.toHaveBeenCalled();
    expect(useStore.getState().blackholeBody).toBe("already here");
  });
});
