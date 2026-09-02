import { describe, expect, it } from "vitest";
import {
  formatIssueFooter,
  formatModelReference,
  formatProviderHandle,
} from "./issueFooter";

describe("issueFooter", () => {
  describe("formatProviderHandle", () => {
    it("maps known providers to GitHub handles", () => {
      expect(formatProviderHandle("anthropic")).toBe("@claude");
      expect(formatProviderHandle("Anthropic")).toBe("@claude");
      expect(formatProviderHandle("openai")).toBe("@openai");
      expect(formatProviderHandle("OpenAI")).toBe("@openai");
      expect(formatProviderHandle("google")).toBe("@google");
      expect(formatProviderHandle("deepseek")).toBe("@deepseek-ai");
      expect(formatProviderHandle("meta")).toBe("@meta");
      expect(formatProviderHandle("mistral")).toBe("@mistralai");
    });

    it("falls back to @<provider> for unknown providers", () => {
      expect(formatProviderHandle("cohere")).toBe("@cohere");
      expect(formatProviderHandle("qwen")).toBe("@qwen");
      expect(formatProviderHandle("custom-llm")).toBe("@custom-llm");
    });
  });

  describe("formatModelReference", () => {
    it("formats provider/model pairs into @handle(model_id)", () => {
      expect(formatModelReference("anthropic/claude-opus-5")).toBe(
        "@claude(claude-opus-5)",
      );
      expect(formatModelReference("openai/gpt-4o")).toBe("@openai(gpt-4o)");
      expect(formatModelReference("google/gemini-2.0-flash")).toBe(
        "@google(gemini-2.0-flash)",
      );
      expect(formatModelReference("deepseek/deepseek-chat")).toBe(
        "@deepseek-ai(deepseek-chat)",
      );
      expect(formatModelReference("meta/llama-3.3-70b-instruct")).toBe(
        "@meta(llama-3.3-70b-instruct)",
      );
      expect(formatModelReference("mistral/mistral-large-2407")).toBe(
        "@mistralai(mistral-large-2407)",
      );
      expect(formatModelReference("cohere/command-r-plus")).toBe(
        "@cohere(command-r-plus)",
      );
    });

    it("formats model specifiers without a slash", () => {
      expect(formatModelReference("custom-model")).toBe(
        "@custom-model(custom-model)",
      );
      expect(formatModelReference("anthropic")).toBe("@claude(anthropic)");
    });
  });

  describe("formatIssueFooter", () => {
    it("formats footer with assigned model", () => {
      expect(
        formatIssueFooter("Roadmap", "anthropic/claude-opus-5"),
      ).toBe(
        "From [sudonotes](https://sudonotes.com) · idea: Roadmap · model: @claude(claude-opus-5)",
      );
      expect(
        formatIssueFooter("Bug Tracker", "deepseek/deepseek-chat"),
      ).toBe(
        "From [sudonotes](https://sudonotes.com) · idea: Bug Tracker · model: @deepseek-ai(deepseek-chat)",
      );
      expect(
        formatIssueFooter("Design System", "openai/gpt-4o"),
      ).toBe(
        "From [sudonotes](https://sudonotes.com) · idea: Design System · model: @openai(gpt-4o)",
      );
      expect(
        formatIssueFooter("Search Pipeline", "cohere/command-r-plus"),
      ).toBe(
        "From [sudonotes](https://sudonotes.com) · idea: Search Pipeline · model: @cohere(command-r-plus)",
      );
    });

    it("omits model segment when model is missing, null, or empty", () => {
      expect(formatIssueFooter("Roadmap")).toBe(
        "From [sudonotes](https://sudonotes.com) · idea: Roadmap",
      );
      expect(formatIssueFooter("Roadmap", null)).toBe(
        "From [sudonotes](https://sudonotes.com) · idea: Roadmap",
      );
      expect(formatIssueFooter("Roadmap", undefined)).toBe(
        "From [sudonotes](https://sudonotes.com) · idea: Roadmap",
      );
      expect(formatIssueFooter("Roadmap", "")).toBe(
        "From [sudonotes](https://sudonotes.com) · idea: Roadmap",
      );
      expect(formatIssueFooter("Roadmap", "   ")).toBe(
        "From [sudonotes](https://sudonotes.com) · idea: Roadmap",
      );
    });
  });
});
