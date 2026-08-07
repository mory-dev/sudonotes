/** Colored, recognizable marks for the LLM providers in the model catalog.
 *
 *  The glyphs are the official brand paths shipped by simple-icons. Providers
 *  it has no mark for fall back to a lettered tile in a deterministic
 *  brand-ish colour. */

import {
  siAlibabacloud,
  siAnthropic,
  siBaidu,
  siDatabricks,
  siDeepseek,
  siGooglegemini,
  siLmstudio,
  siMeituan,
  siMeta,
  siMinimax,
  siMistralai,
  siMoonshotai,
  siNvidia,
  siOllama,
  siOpenrouter,
  siPerplexity,
  siQwen,
  siReplicate,
  siSnowflake,
  siXiaomi,
} from "simple-icons";

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
  // Official lab keys as listed by the models.dev /models.json catalog.
  moonshotai: { color: "#6c5ce7", short: "Moonshot" },
  zhipuai: { color: "#315efb", short: "Zhipu" },
  xiaomi: { color: "#ff6900", short: "Xiaomi" },
  meituan: { color: "#ffd100", short: "Meituan" },
  poolside: { color: "#ff4e00", short: "Poolside" },
  sakana: { color: "#ff4d00", short: "Sakana AI" },
  sarvam: { color: "#d22030", short: "Sarvam" },
  sdaia: { color: "#1cbf43", short: "SDAIA" },
  deepreinforce: { color: "#7a4cff", short: "Deepreinforce" },
  thinkingmachines: { color: "#111827", short: "Thinking Machines" },
};

/** Official brand marks, from the simple-icons package: one 24x24 path each,
 *  drawn white on the provider's colour tile. These replace the hand-drawn
 *  approximations this file used to carry.
 *
 *  Providers absent here have no mark in simple-icons — several vendors,
 *  OpenAI and Microsoft among them, have asked for theirs not to be
 *  redistributed — so they fall back to the lettered tile below rather than to
 *  a guess at their logo. */
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
  moonshotai: siMoonshotai,
  xiaomi: siXiaomi,
  meituan: siMeituan,
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

function providerLabel(provider: string, fallbackKey: string): string {
  const source = provider.trim() || fallbackKey || "?";
  const cleaned = source
    .replace(/^[^a-z0-9]+/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const initials = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return initials || (source[0] || "?").toUpperCase();
}

export function ProviderIcon({
  provider,
  size = 15,
}: {
  provider: string;
  size?: number;
}) {
  const safeProvider = provider?.trim() || "";
  const key = canonical(safeProvider.toLowerCase());
  const style = PROVIDERS[key] ?? { color: fallbackColor(key), short: "" };
  const glyph = GLYPHS[key];
  const title = style.short || safeProvider || provider;
  const label = providerLabel(safeProvider || style.short || key, key);
  // simple-icons marks span the full 24-unit canvas, so drawn at the tile's own
  // size they touch its edges and clip on its 4px corners. Inset them instead;
  // the tile centres what it is given.
  const glyphSize = Math.round(size * 0.72);

  return (
    <span
      className="provider-icon"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.55),
        background: style.color,
      }}
      data-tooltip={title}
    >
      {glyph ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={glyphSize}
          height={glyphSize}
          aria-hidden="true"
          focusable="false"
        >
          <path d={glyph.path} fill="#fff" />
        </svg>
      ) : (
        label
      )}
    </span>
  );
}

/** A provider mark rendered as raw HTML, for CodeMirror widgets that cannot
 *  mount React components. */
export function providerMarkHtml(provider: string, size = 13): string {
  const safe = (provider ?? "").trim();
  const key = canonical(safe.toLowerCase());
  const style = PROVIDERS[key] ?? { color: fallbackColor(key), short: "" };
  const glyph = GLYPHS[key];
  const title = (style.short || safe || "?")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
  const glyphSize = Math.round(size * 0.72);
  const icon = glyph
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${glyphSize}" height="${glyphSize}" aria-hidden="true"><path d="${glyph.path}" fill="#fff"/></svg>`
    : `<span class="provider-mark-fallback">${providerLabel(safe || style.short || key, key)}</span>`;
  return `<span class="provider-mark" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.55)}px;background:${style.color}" data-tooltip="${title}">${icon}</span>`;
}
