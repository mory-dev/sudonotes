import { hashIp, mintDevice, readDevice, verifyTurnstile } from "./auth";

export { Limiter } from "./limiter";

const HOUR_MS = 60 * 60 * 1000;
/** Budget instances are keyed by date, so their window need only outlast a day. */
const DAY_WINDOW_MS = 48 * HOUR_MS;
const CATALOG_URL = "https://models.dev/api.json";

interface ChatMessage {
  role: string;
  content: string;
}

interface ChatRequest {
  model?: unknown;
  messages?: unknown;
  temperature?: unknown;
  response_format?: unknown;
}

const num = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

function corsHeaders(origin: string | null, env: Env): Headers {
  const headers = new Headers({ "Vary": "Origin" });
  if (origin && list(env.ALLOWED_ORIGINS).includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Cf-Turnstile-Response, X-Sudonotes-Device",
    );
    headers.set("Access-Control-Max-Age", "86400");
  }
  return headers;
}

function fail(status: number, message: string, headers: Headers): Response {
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify({ error: { message } }), { status, headers });
}

/** Read at most `limit` bytes of a body, refusing rather than truncating. */
async function readCapped(request: Request, limit: number): Promise<string | null> {
  const body = request.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/** Reject anything that is not a plain, bounded chat request. */
function validate(body: ChatRequest, env: Env): { model: string; messages: ChatMessage[] } | string {
  const model = typeof body.model === "string" ? body.model : "";
  if (!list(env.ALLOWED_MODELS).includes(model)) return `unsupported model: ${model || "(none)"}`;
  if (!Array.isArray(body.messages) || body.messages.length === 0) return "messages must be a non-empty array";
  if (body.messages.length > 8) return "too many messages";

  const messages: ChatMessage[] = [];
  for (const raw of body.messages) {
    const item = raw as Partial<ChatMessage>;
    if (typeof item?.role !== "string" || typeof item?.content !== "string") {
      return "each message needs a string role and content";
    }
    if (!["system", "user", "assistant"].includes(item.role)) return `unsupported role: ${item.role}`;
    messages.push({ role: item.role, content: item.content });
  }
  return { model, messages };
}

async function limit(
  env: Env,
  name: string,
  cost: number,
  cap: number,
  windowMs: number,
): Promise<boolean> {
  const usage = await env.LIMITER.getByName(name).consume(cost, cap, windowMs);
  return usage.ok;
}

async function handleChat(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const origin = request.headers.get("Origin");
  const headers = corsHeaders(origin, env);

  // A browser that is not one of ours never gets past here, Turnstile or not.
  if (origin && !headers.has("Access-Control-Allow-Origin")) {
    return fail(403, "origin not allowed", headers);
  }

  const raw = await readCapped(request, num(env.MAX_REQUEST_BYTES, 32768));
  if (raw === null) return fail(413, "request too large", headers);

  let parsed: ChatRequest;
  try {
    parsed = JSON.parse(raw) as ChatRequest;
  } catch {
    return fail(400, "body must be JSON", headers);
  }

  const checked = validate(parsed, env);
  if (typeof checked === "string") return fail(400, checked, headers);

  const ip = request.headers.get("CF-Connecting-IP");

  // Browser callers must clear Turnstile. Desktop callers have no origin and are
  // held to per-device and per-IP counters instead.
  if (origin) {
    const token = request.headers.get("Cf-Turnstile-Response");
    if (!token) return fail(401, "turnstile token required", headers);
    if (!(await verifyTurnstile(token, env.TURNSTILE_SECRET, ip))) {
      return fail(401, "turnstile verification failed", headers);
    }
  }

  const presented = request.headers.get("X-Sudonotes-Device");
  const device = presented ? await readDevice(presented, env.DEVICE_TOKEN_SECRET) : null;
  if (presented && !device) return fail(401, "invalid device token", headers);

  if (device && !(await limit(env, `device:${device}`, 1, num(env.DEVICE_HOURLY_LIMIT, 60), HOUR_MS))) {
    return fail(429, "device rate limit reached", headers);
  }
  if (ip) {
    const subject = await hashIp(ip, env.DEVICE_TOKEN_SECRET);
    if (!(await limit(env, `ip:${subject}`, 1, num(env.IP_HOURLY_LIMIT, 120), HOUR_MS))) {
      return fail(429, "rate limit reached", headers);
    }
  }

  // The spend ceiling is checked before the call and charged after it, so an
  // exhausted budget fails closed and the client falls back to local tagging.
  const budget = `budget:${new Date().toISOString().slice(0, 10)}`;
  const cap = num(env.DAILY_BUDGET_MICRO_USD, 5_000_000);
  if (!(await limit(env, budget, 0, cap, DAY_WINDOW_MS))) {
    return fail(503, "daily capacity reached", headers);
  }

  const upstream = await callUpstream(checked.model, checked.messages, parsed, env);
  if (!upstream.ok) return fail(upstream.status, upstream.message, headers);

  ctx.waitUntil(
    env.LIMITER.getByName(budget)
      .consume(upstream.cost, cap, DAY_WINDOW_MS)
      .then(() => undefined),
  );

  headers.set("Content-Type", "application/json");
  return new Response(
    JSON.stringify({
      model: checked.model,
      choices: [{ index: 0, message: { role: "assistant", content: upstream.content } }],
      usage: upstream.usage,
    }),
    { status: 200, headers },
  );
}

interface UpstreamOk {
  ok: true;
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number };
  /** What this call cost, in micro-dollars, for the daily budget. */
  cost: number;
}
type UpstreamResult = UpstreamOk | { ok: false; status: number; message: string };

async function callUpstream(
  model: string,
  messages: ChatMessage[],
  original: ChatRequest,
  env: Env,
): Promise<UpstreamResult> {
  const payload: Record<string, unknown> = {
    model,
    messages,
    max_tokens: num(env.MAX_OUTPUT_TOKENS, 1024),
    temperature: typeof original.temperature === "number" ? original.temperature : 0.1,
    stream: false,
  };
  // The client asks for strict JSON; that is the only response_format we honour.
  const format = original.response_format as { type?: unknown } | undefined;
  if (format?.type === "json_object") payload.response_format = { type: "json_object" };

  let response: Response;
  try {
    response = await fetch(env.UPSTREAM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(num(env.UPSTREAM_TIMEOUT_MS, 30000)),
    });
  } catch {
    // Never echo the provider's failure back to the caller.
    console.error(JSON.stringify({ event: "upstream_unreachable", model }));
    return { ok: false, status: 502, message: "upstream unavailable" };
  }

  if (!response.ok) {
    console.error(JSON.stringify({ event: "upstream_error", model, status: response.status }));
    return { ok: false, status: 502, message: "upstream error" };
  }

  const body = (await response.json()) as {
    choices?: { message?: { content?: unknown } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string") return { ok: false, status: 502, message: "upstream returned no content" };

  const prompt = body.usage?.prompt_tokens ?? 0;
  const completion = body.usage?.completion_tokens ?? 0;
  const cost = Math.ceil(
    (prompt * num(env.INPUT_MICRO_USD_PER_MTOK, 270_000)) / 1_000_000 +
      (completion * num(env.OUTPUT_MICRO_USD_PER_MTOK, 1_100_000)) / 1_000_000,
  );

  // Counts and cost only. Note content never reaches a log line.
  console.log(JSON.stringify({ event: "completion", model, prompt, completion, cost }));
  return { ok: true, content, usage: { prompt_tokens: prompt, completion_tokens: completion }, cost };
}

/**
 * models.dev, proxied so the browser app can read it without hitting CORS.
 * Passed through verbatim — the desktop client already parses this exact shape.
 */
async function handleModels(request: Request, env: Env): Promise<Response> {
  const headers = corsHeaders(request.headers.get("Origin"), env);
  const upstream = await fetch(CATALOG_URL, {
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!upstream.ok) return fail(502, "model catalog unavailable", headers);

  headers.set("Content-Type", "application/json");
  headers.set("Cache-Control", "public, max-age=3600");
  return new Response(upstream.body, { status: 200, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }

    try {
      if (url.pathname === "/api/v1/chat/completions" && request.method === "POST") {
        return await handleChat(request, env, ctx);
      }
      if (url.pathname === "/api/v1/models" && request.method === "GET") {
        return await handleModels(request, env);
      }
      if (url.pathname === "/api/v1/device" && request.method === "POST") {
        const headers = corsHeaders(origin, env);
        const ip = request.headers.get("CF-Connecting-IP");
        if (ip) {
          const subject = await hashIp(ip, env.DEVICE_TOKEN_SECRET);
          if (!(await limit(env, `mint:${subject}`, 1, 10, 24 * HOUR_MS))) {
            return fail(429, "too many device registrations", headers);
          }
        }
        headers.set("Content-Type", "application/json");
        return new Response(JSON.stringify({ device: await mintDevice(env.DEVICE_TOKEN_SECRET) }), {
          status: 200,
          headers,
        });
      }
      return fail(404, "not found", corsHeaders(origin, env));
    } catch (error) {
      console.error(JSON.stringify({ event: "unhandled", message: String(error) }));
      return fail(500, "internal error", corsHeaders(origin, env));
    }
  },
} satisfies ExportedHandler<Env>;
