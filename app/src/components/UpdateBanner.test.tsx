import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";

import { api } from "../api";
import { UpdateBanner, UpdateToast } from "./UpdateBanner";

// Mock Tauri dependencies
vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

describe("UpdateBanner / UpdateToast component", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.spyOn(api, "appVersion").mockResolvedValue("0.3.5");
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

  it("exports UpdateToast as an alias for UpdateBanner", () => {
    expect(UpdateToast).toBe(UpdateBanner);
  });

  it("renders nothing when no update is available", async () => {
    vi.mocked(check).mockResolvedValue(null);

    await act(async () => {
      root.render(<UpdateBanner />);
    });

    expect(container.querySelector(".update-toast")).toBeNull();
    expect(container.querySelector(".update-banner")).toBeNull();
  });

  it("renders the bottom-right update toast with version badge, title, action, and dismiss button", async () => {
    const mockUpdate = {
      version: "0.3.6",
      downloadAndInstall: vi.fn(),
    } as unknown as Update;

    vi.mocked(check).mockResolvedValue(mockUpdate);

    await act(async () => {
      root.render(<UpdateBanner />);
    });

    const toast = container.querySelector(".update-toast")!;
    expect(toast).not.toBeNull();
    expect(toast.classList.contains("update-banner")).toBe(true);

    const badge = toast.querySelector(".update-toast-badge")!;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe("0.3.6");

    const title = toast.querySelector(".update-toast-title")!;
    expect(title.textContent).toBe("Update available");

    const actionButton = toast.querySelector(".update-toast-action")!;
    expect(actionButton).not.toBeNull();
    expect(actionButton.textContent).toContain("Update now");

    const dismissButton = toast.querySelector(".update-toast-close")!;
    expect(dismissButton).not.toBeNull();
    expect(dismissButton.getAttribute("aria-label")).toBe("Dismiss update notification");
  });

  it("hides the toast for the current session when dismiss button is clicked", async () => {
    const mockUpdate = {
      version: "0.3.6",
      downloadAndInstall: vi.fn(),
    } as unknown as Update;

    vi.mocked(check).mockResolvedValue(mockUpdate);

    await act(async () => {
      root.render(<UpdateBanner />);
    });

    expect(container.querySelector(".update-toast")).not.toBeNull();

    const dismissButton = container.querySelector(".update-toast-close") as HTMLButtonElement;
    act(() => {
      dismissButton.click();
    });

    expect(container.querySelector(".update-toast")).toBeNull();
  });

  it("triggers downloadAndInstall and relaunch when the update button is clicked", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);

    const mockUpdate = {
      version: "0.3.6",
      downloadAndInstall,
    } as unknown as Update;

    vi.mocked(check).mockResolvedValue(mockUpdate);

    await act(async () => {
      root.render(<UpdateBanner />);
    });

    const actionButton = container.querySelector(".update-toast-action") as HTMLButtonElement;

    await act(async () => {
      actionButton.click();
    });

    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("updates progress bar and percentage during download", async () => {
    let progressCallback: ((event: DownloadEvent) => void) | undefined;
    let finishPromiseResolve: () => void;
    const finishPromise = new Promise<void>((resolve) => {
      finishPromiseResolve = resolve;
    });

    const downloadAndInstall = vi.fn().mockImplementation((cb) => {
      progressCallback = cb;
      return finishPromise;
    });

    const mockUpdate = {
      version: "0.3.6",
      downloadAndInstall,
    } as unknown as Update;

    vi.mocked(check).mockResolvedValue(mockUpdate);

    await act(async () => {
      root.render(<UpdateBanner />);
    });

    const actionButton = container.querySelector(".update-toast-action") as HTMLButtonElement;

    await act(async () => {
      actionButton.click();
    });

    // Simulate download start and progress
    act(() => {
      progressCallback?.({
        event: "Started",
        data: { contentLength: 1000 },
      });
      progressCallback?.({
        event: "Progress",
        data: { chunkLength: 500 },
      });
    });

    expect(container.textContent).toContain("Downloading 0.3.6… 50%");
    const fill = container.querySelector(".update-toast-progress-fill") as HTMLElement;
    expect(fill.style.width).toBe("50%");

    // Simulate finish
    act(() => {
      progressCallback?.({
        event: "Finished",
      });
    });

    expect(container.textContent).toContain("Applying update…");

    await act(async () => {
      finishPromiseResolve();
    });
  });

  it("displays error state and provides retry and manual download options on failure", async () => {
    const downloadAndInstall = vi.fn().mockRejectedValue(new Error("Network failed"));

    const mockUpdate = {
      version: "0.3.6",
      downloadAndInstall,
    } as unknown as Update;

    vi.mocked(check).mockResolvedValue(mockUpdate);

    await act(async () => {
      root.render(<UpdateBanner />);
    });

    const actionButton = container.querySelector(".update-toast-action") as HTMLButtonElement;

    await act(async () => {
      actionButton.click();
    });

    expect(container.textContent).toContain("Update failed");
    expect(container.textContent).toContain("Couldn't apply the update automatically.");

    const retryButton = container.querySelector(".update-toast-action") as HTMLButtonElement;
    expect(retryButton.textContent).toContain("Try again");

    const manualButton = container.querySelector(".update-toast-secondary") as HTMLButtonElement;
    expect(manualButton.textContent).toContain("Manual download");

    await act(async () => {
      manualButton.click();
    });

    expect(openUrl).toHaveBeenCalledWith("https://sudonotes.com/download");
  });
});
