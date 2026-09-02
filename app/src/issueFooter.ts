/** Map an LLM provider identifier to its official GitHub handle. */
export function formatProviderHandle(provider: string): string {
  const key = provider.trim().toLowerCase();
  switch (key) {
    case "anthropic":
      return "@claude";
    case "openai":
      return "@openai";
    case "google":
      return "@google";
    case "deepseek":
      return "@deepseek-ai";
    case "meta":
      return "@meta";
    case "mistral":
      return "@mistralai";
    default:
      return `@${key}`;
  }
}

/** Format a model specifier for GitHub issue footers, e.g. `@claude(claude-opus-5)`. */
export function formatModelReference(model: string): string {
  const trimmed = model.trim();
  const slash = trimmed.indexOf("/");
  if (slash >= 0) {
    const provider = trimmed.slice(0, slash);
    const modelId = trimmed.slice(slash + 1);
    const handle = formatProviderHandle(provider);
    return `${handle}(${modelId.trim()})`;
  }
  const handle = formatProviderHandle(trimmed);
  return `${handle}(${trimmed})`;
}

/** Format the footer appended to GitHub issues created from idea bubbles.
 *
 *  If a model is provided, includes ` · model: @<provider_handle>(<model_id>)`.
 *  If no model is assigned, omits the model segment. */
export function formatIssueFooter(noteTitle: string, model?: string | null): string {
  const title = noteTitle.trim();
  const cleanModel = model?.trim();
  if (cleanModel) {
    return `From [sudonotes](https://sudonotes.com) · idea: ${title} · model: ${formatModelReference(cleanModel)}`;
  }
  return `From [sudonotes](https://sudonotes.com) · idea: ${title}`;
}
