/** Colored, recognizable marks for the LLM providers in the model catalog.
 *
 *  The glyphs are simplified hand-drawn approximations of each brand, not
 *  official artwork — fine for a local tool, worth replacing with vendor assets
 *  before any public release. Providers with no glyph fall back to a lettered
 *  tile in a deterministic brand-ish colour. */

import type { ReactNode } from "react";

const PROVIDERS: Record<string, { color: string; short: string }> = {
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

/** Brand glyphs, drawn white on the provider's colour tile. */
const GLYPHS: Record<string, ReactNode> = {
  // Interlocking knot, reduced to its hexagonal skeleton.
  openai: (
    <g fill="none" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M8 2.2 13 5.1v5.8L8 13.8 3 10.9V5.1Z" />
      <path d="M8 2.2v5.8l5 2.9M8 8 3 10.9" />
    </g>
  ),
  // Splayed "A" with the crossbar its logo is known for.
  anthropic: (
    <g fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round">
      <path d="M3.2 13 8 3l4.8 10" />
      <path d="M5.6 9.6h4.8" />
    </g>
  ),
  // Gemini's four-pointed spark.
  google: (
    <path
      fill="#fff"
      d="M8 1.7c.5 3 2.8 5.3 5.8 5.8v1c-3 .5-5.3 2.8-5.8 5.8h-1C6.5 11.3 4.2 9 1.2 8.5v-1C4.2 7 6.5 4.7 7 1.7Z"
    />
  ),
  // Whale silhouette.
  deepseek: (
    <g fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.8 9.2c1.6-3 4.2-4.4 7-4.1 1.7.2 3 1.1 3.6 2.4l1.8-1.6-.4 3.2c-.9 2-3.1 3.2-5.9 3.1-2.8-.1-5-1.2-6.1-3Z" />
      <circle cx="9.6" cy="7.6" r=".8" fill="#fff" stroke="none" />
    </g>
  ),
  // Stacked band grid.
  mistral: (
    <g fill="#fff">
      <rect x="2.5" y="3" width="2.6" height="10" />
      <rect x="6.7" y="3" width="2.6" height="3.2" />
      <rect x="10.9" y="3" width="2.6" height="3.2" />
      <rect x="6.7" y="9.8" width="2.6" height="3.2" />
      <rect x="10.9" y="9.8" width="2.6" height="3.2" />
    </g>
  ),
  // Interlocking infinity loops.
  meta: (
    <path
      fill="none"
      stroke="#fff"
      strokeWidth="1.6"
      strokeLinecap="round"
      d="M2.2 10.4c0-3 1.5-5.2 3.2-5.2 2.3 0 3.3 6 5.4 6 1.5 0 2.5-1.6 2.5-3.5S12.4 4.2 11 4.2C8.6 4.2 7 10.4 4.7 10.4c-1.4 0-2.5-1.1-2.5-2.6"
    />
  ),
  xai: (
    <g fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round">
      <path d="M3.4 3.4 12.6 12.6M12.6 3.4 3.4 12.6" />
    </g>
  ),
  microsoft: (
    <g fill="#fff">
      <rect x="2.6" y="2.6" width="5" height="5" />
      <rect x="8.4" y="2.6" width="5" height="5" />
      <rect x="2.6" y="8.4" width="5" height="5" />
      <rect x="8.4" y="8.4" width="5" height="5" />
    </g>
  ),
  // The smile arrow.
  amazon: (
    <g fill="none" stroke="#fff" strokeLinecap="round">
      <path strokeWidth="1.6" d="M2.6 9.8c3.4 2.4 7.8 2.5 11.2.3" />
      <path strokeWidth="1.5" d="M11.2 9.4l2.7.5-.6 2.6" />
    </g>
  ),
  // Stylised eye.
  nvidia: (
    <g fill="none" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M1.8 8c2-2.6 4-3.9 6.2-3.9 2.8 0 5 1.5 6.2 3.9-1.6 2.5-3.7 3.9-6.2 3.9S3.4 10.5 1.8 8Z" />
      <circle cx="8" cy="8" r="1.7" fill="#fff" stroke="none" />
    </g>
  ),
  // Layered chevrons.
  perplexity: (
    <g fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2.4v11.2" />
      <path d="M8 5.6 3.4 2.9v5.4L8 11M8 5.6l4.6-2.7v5.4L8 11" />
    </g>
  ),
  // Concentric arcs.
  cohere: (
    <g fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round">
      <path d="M11.6 4.6a4.6 4.6 0 1 0 0 6.8" />
      <path d="M9.2 7.2a1.6 1.6 0 1 0 0 1.6" />
    </g>
  ),
  moonshot: (
    <path
      fill="#fff"
      d="M10.4 1.9a6.4 6.4 0 1 0 3.7 9.9A5.3 5.3 0 0 1 10.4 1.9Z"
    />
  ),
  qwen: (
    <g fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.2 3.2 8 9.6l3.8-6.4" />
      <path d="M2.4 9.6h5.2M8.4 9.6h5.2M8 9.6v3.4" />
    </g>
  ),
  groq: (
    <g fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.2 5.2a4.8 4.8 0 1 0 .6 4.6" />
      <path d="M13.2 8H8.6" />
    </g>
  ),
};

/** The provider key for a model id like `deepseek/deepseek-chat`. */
export function providerOf(modelId: string): string {
  const trimmed = modelId.trim();
  const slash = trimmed.indexOf("/");
  const key = slash >= 0 ? trimmed.slice(0, slash) : trimmed.split(/[\s-]+/)[0];
  return key.toLowerCase();
}

/** A short, readable model name, e.g. "Claude Opus 4.5" -> "Opus 4.5",
 *  "deepseek/deepseek-chat" -> "chat". */
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

export function ProviderIcon({
  provider,
  size = 15,
}: {
  provider: string;
  size?: number;
}) {
  const key = canonical(provider.toLowerCase());
  const style = PROVIDERS[key] ?? { color: fallbackColor(key), short: "" };
  const glyph = GLYPHS[key] ?? (key === "meta-llama" ? GLYPHS.meta : undefined);
  const title = style.short || provider;

  if (glyph) {
    return (
      <span
        className="provider-icon"
        style={{ width: size, height: size, background: style.color }}
        title={title}
      >
        <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
          {glyph}
        </svg>
      </span>
    );
  }

  // No glyph for this provider — fall back to a lettered tile.
  const label = (style.short || key || "?").replace(/^[\d._-]+/, "");
  return (
    <span
      className="provider-icon"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.55),
        background: style.color,
      }}
      title={title}
    >
      {(label.charAt(0) || "?").toUpperCase()}
    </span>
  );
}
