import { beforeEach, describe, expect, it } from "vitest";
import {
  clampPromptHeight,
  clearPromptHeights,
  loadPromptHeights,
  MAX_PROMPT_HEIGHT,
  MIN_PROMPT_HEIGHT,
  PROMPT_HEIGHTS_STORAGE_KEY,
  removePromptHeight,
  savePromptHeight,
} from "./promptHeightStorage";

describe("promptHeightStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("clampPromptHeight", () => {
    it("clamps values below minimum (70px) to 70px", () => {
      expect(clampPromptHeight(0)).toBe(MIN_PROMPT_HEIGHT);
      expect(clampPromptHeight(-100)).toBe(MIN_PROMPT_HEIGHT);
      expect(clampPromptHeight(69)).toBe(MIN_PROMPT_HEIGHT);
      expect(clampPromptHeight(MIN_PROMPT_HEIGHT)).toBe(MIN_PROMPT_HEIGHT);
    });

    it("clamps values above maximum (700px) to 700px", () => {
      expect(clampPromptHeight(701)).toBe(MAX_PROMPT_HEIGHT);
      expect(clampPromptHeight(1200)).toBe(MAX_PROMPT_HEIGHT);
      expect(clampPromptHeight(MAX_PROMPT_HEIGHT)).toBe(MAX_PROMPT_HEIGHT);
    });

    it("preserves valid heights between 70px and 700px", () => {
      expect(clampPromptHeight(70)).toBe(70);
      expect(clampPromptHeight(190)).toBe(190);
      expect(clampPromptHeight(350)).toBe(350);
      expect(clampPromptHeight(700)).toBe(700);
    });

    it("rounds fractional heights to nearest integer", () => {
      expect(clampPromptHeight(120.4)).toBe(120);
      expect(clampPromptHeight(120.6)).toBe(121);
    });

    it("handles invalid inputs like NaN safely", () => {
      expect(clampPromptHeight(NaN)).toBe(MIN_PROMPT_HEIGHT);
      expect(clampPromptHeight(undefined as unknown as number)).toBe(MIN_PROMPT_HEIGHT);
    });
  });

  describe("localStorage persistence", () => {
    it("saves and loads customized prompt heights keyed by prompt ID", () => {
      savePromptHeight("prompt-1", 250);
      savePromptHeight("prompt-2", 480);

      const heights = loadPromptHeights();
      expect(heights["prompt-1"]).toBe(250);
      expect(heights["prompt-2"]).toBe(480);
    });

    it("clamps height when saving", () => {
      const saved1 = savePromptHeight("p-small", 30);
      expect(saved1).toBe(MIN_PROMPT_HEIGHT);

      const saved2 = savePromptHeight("p-big", 9999);
      expect(saved2).toBe(MAX_PROMPT_HEIGHT);

      const heights = loadPromptHeights();
      expect(heights["p-small"]).toBe(MIN_PROMPT_HEIGHT);
      expect(heights["p-big"]).toBe(MAX_PROMPT_HEIGHT);
    });

    it("removes a specific prompt height", () => {
      savePromptHeight("p-1", 200);
      savePromptHeight("p-2", 300);

      removePromptHeight("p-1");

      const heights = loadPromptHeights();
      expect(heights["p-1"]).toBeUndefined();
      expect(heights["p-2"]).toBe(300);
    });

    it("clears all prompt heights", () => {
      savePromptHeight("p-1", 200);
      savePromptHeight("p-2", 300);

      clearPromptHeights();

      expect(loadPromptHeights()).toEqual({});
      expect(localStorage.getItem(PROMPT_HEIGHTS_STORAGE_KEY)).toBeNull();
    });

    it("handles corrupted or invalid JSON in localStorage gracefully", () => {
      localStorage.setItem(PROMPT_HEIGHTS_STORAGE_KEY, "invalid-json{{");
      expect(loadPromptHeights()).toEqual({});

      localStorage.setItem(PROMPT_HEIGHTS_STORAGE_KEY, JSON.stringify({ "p-bad": "not-a-number", "p-out": 9999 }));
      const heights = loadPromptHeights();
      expect(heights["p-bad"]).toBeUndefined();
      expect(heights["p-out"]).toBe(MAX_PROMPT_HEIGHT);
    });
  });
});
