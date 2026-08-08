/**
 * Provider identity, copied from app/src/components/ProviderMarks.tsx so the
 * previews render the same colored tiles and short names as the product.
 *
 * The glyphs are the official brand paths shipped by simple-icons; the colors
 * are the vendors' real trademarked hexes.
 */

import {
  siAlibabacloud,
  siAnthropic,
  siBaidu,
  siDatabricks,
  siDeepseek,
  siGooglegemini,
  siLmstudio,
  siMeta,
  siMinimax,
  siMistralai,
  siNvidia,
  siOllama,
  siOpenrouter,
  siPerplexity,
  siQwen,
  siReplicate,
  siSnowflake,
} from "simple-icons";

export const PROVIDERS: Record<string, { color: string; short: string }> = {
  openai: { color: "#10a37f", short: "OpenAI" },
  anthropic: { color: "#d97757", short: "Anthropic" },
  google: { color: "#4285f4", short: "Google" },
  deepseek: { color: "#4d6bfe", short: "DeepSeek" },
  mistral: { color: "#f7a92a", short: "Mistral" },
  meta: { color: "#0866ff", short: "Meta" },
  "meta-llama": { color: "#0866ff", short: "Meta" },
  xai: { color: "#111318", short: "xAI" },
  moonshot: { color: "#6c5ce7", short: "Moonshot" },
  cohere: { color: "#39594d", short: "Cohere" },
  together: { color: "#7c3aed", short: "Together" },
  groq: { color: "#f55036", short: "Groq" },
  openrouter: { color: "#8248e5", short: "OpenRouter" },
  perplexity: { color: "#20808d", short: "Perplexity" },
  qwen: { color: "#615ced", short: "Qwen" },
  alibaba: { color: "#ff6a00", short: "Alibaba" },
  zhipu: { color: "#315efb", short: "Zhipu" },
  amazon: { color: "#ff9900", short: "Amazon" },
  microsoft: { color: "#00a4ef", short: "Microsoft" },
  nvidia: { color: "#76b900", short: "NVIDIA" },
  ai21: { color: "#f36522", short: "AI21" },
  "01-ai": { color: "#7a4cff", short: "01.AI" },
  "x-ai": { color: "#111318", short: "xAI" },
  minimax: { color: "#4f7cff", short: "MiniMax" },
  stepfun: { color: "#5e5ce6", short: "StepFun" },
  baidu: { color: "#2932e1", short: "Baidu" },
  tencent: { color: "#1fb6ff", short: "Tencent" },
  volcengine: { color: "#1e80ff", short: "Volcengine" },
  deepinfra: { color: "#9b3bff", short: "DeepInfra" },
  fireworks: { color: "#f43f5e", short: "Fireworks" },
  novita: { color: "#38bdf8", short: "Novita" },
  sambanova: { color: "#00c1de", short: "SambaNova" },
  upstage: { color: "#00b389", short: "Upstage" },
  snowflake: { color: "#29b5e8", short: "Snowflake" },
  lmstudio: { color: "#4f46e5", short: "LM Studio" },
  ollama: { color: "#8a5cf6", short: "Ollama" },
  cerebras: { color: "#1e6fe5", short: "Cerebras" },
  replicate: { color: "#003cff", short: "Replicate" },
  databricks: { color: "#ff3621", short: "Databricks" },
};

/** Official brand marks, from the simple-icons package: one 24x24 path each,
 *  drawn white on the provider's colour tile.
 *
 *  Providers absent here have no mark in simple-icons — several vendors, OpenAI
 *  and Microsoft among them, have asked for theirs not to be redistributed — so
 *  they fall back to the lettered tile rather than to a guess at their logo.
 *  Kept in step with app/src/components/ProviderMarks.tsx, which reads the same
 *  package. */
const GLYPHS: Record<string, { path: string }> = {
  anthropic: siAnthropic,
  google: siGooglegemini,
  deepseek: siDeepseek,
  mistral: siMistralai,
  meta: siMeta,
  "meta-llama": siMeta,
  openrouter: siOpenrouter,
  perplexity: siPerplexity,
  qwen: siQwen,
  alibaba: siAlibabacloud,
  nvidia: siNvidia,
  minimax: siMinimax,
  baidu: siBaidu,
  snowflake: siSnowflake,
  lmstudio: siLmstudio,
  ollama: siOllama,
  replicate: siReplicate,
  databricks: siDatabricks,
};

/** The provider key for a model id like `deepseek/deepseek-v4`. */
export function providerOf(modelId: string): string {
  const trimmed = modelId.trim();
  const slash = trimmed.indexOf("/");
  const key = slash >= 0 ? trimmed.slice(0, slash) : trimmed.split(/[\s-]+/)[0];
  return key.toLowerCase();
}

/** A short, readable model name, e.g. "Claude Opus 4.5" -> "Opus 4.5",
 *  "deepseek/deepseek-v4" -> "chat". */
export function shortModelName(name: string, provider?: string): string {
  const raw = name.trim();
  let short = raw.includes("/") ? raw.slice(raw.lastIndexOf("/") + 1) : raw;
  const family = (provider ?? "")
    .toLowerCase()
    .split(/[\s/._-]+/)
    .filter(Boolean);

  const tokens = short.split(/\s+/);
  let i = 0;
  while (i < tokens.length && family.includes(tokens[i].toLowerCase())) i++;
  let out = tokens.slice(i).join(" ").trim();

  // A hyphenated brand prefix, e.g. "deepseek-chat".
  for (const f of family) {
    if (out.length > f.length && out.toLowerCase().startsWith(`${f}-`)) {
      out = out.slice(f.length + 1);
      break;
    }
  }

  out = out
    .replace(/^(claude|gemini|gpt|deepseek|kimi|llama|mistral|qwen|command)\s+/i, "")
    .trim();
  return out || raw;
}

/** Deterministic brand-ish hue for providers we don't have an entry for, so a
 *  colored icon always renders instead of a gray box. */
function fallbackColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 45% 42%)`;
}

/** Normalised lookup key, tolerating separators ("01.ai", "01-ai", "x-ai"). */
function canonical(key: string): string {
  const direct = PROVIDERS[key] ? key : PROVIDERS[providerOf(key)] ? providerOf(key) : null;
  if (direct) return direct;
  const norm = key.replace(/[^a-z0-9]/g, "");
  for (const name of Object.keys(PROVIDERS)) {
    if (name.replace(/[^a-z0-9]/g, "") === norm) return name;
  }
  return key;
}

/** Display name for a provider key, e.g. "x-ai" -> "xAI". */
export function providerName(provider: string): string {
  const key = canonical(provider.toLowerCase());
  return PROVIDERS[key]?.short || provider;
}

/** The colour, short name and brand path for a provider key. */
export function providerStyle(
  provider: string,
): { color: string; short: string; path?: string } {
  const key = canonical(provider.toLowerCase());
  const style = PROVIDERS[key] ?? { color: fallbackColor(key), short: "" };
  return { color: style.color, short: style.short || provider, path: GLYPHS[key]?.path };
}

/** The letter a provider with no glyph falls back to. */
export function providerInitial(provider: string, short: string): string {
  const label = (short || provider).replace(/^[\d._-]+/, "");
  return (label.charAt(0) || "?").toUpperCase();
}
