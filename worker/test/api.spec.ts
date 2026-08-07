import { createExecutionContext, env, reset, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mintDevice, readDevice } from "../src/auth";
import worker from "../src/index";

const APP = "https://app.sudonotes.com";
const API = "https://sudonotes.com/api/v1/chat/completions";

/** What the stubbed network should do for this test. */
let upstream: () => Response;
let turnstile: boolean;
/** Every outbound URL the worker asked for, so tests can assert it stopped early. */
let calls: string[];

const body = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    model: "deepseek-chat",
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "classify" },
      { role: "user", content: "a note" },
    ],
    ...over,
  });

const completion = (content: string, prompt = 100, completionTokens = 20) =>
  Response.json({
    choices: [{ message: { role: "assistant", content } }],
    usage: { prompt_tokens: prompt, completion_tokens: completionTokens },
  });

/** Run a request through the worker and settle its `waitUntil` work. */
async function call(init: RequestInit = {}, url = API): Promise<Response> {
  const request = new Request(url, { method: "POST", body: body(), ...init });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

beforeEach(() => {
  upstream = () => completion('{"tags":["bug"]}');
  turnstile = true;
  calls = [];

  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    if (url.startsWith("https://challenges.cloudflare.com")) {
      return Response.json({ success: turnstile });
    }
    if (url.startsWith("https://api.deepseek.com")) return upstream();
    if (url.startsWith("https://models.dev")) return Response.json({ deepseek: { models: {} } });
    throw new Error(`unexpected outbound request: ${url}`);
  });
});

// Counters are keyed by device, IP and date, so without this the limit tests
// would depend on the order they run in.
afterEach(async () => {
  vi.unstubAllGlobals();
  await reset();
});

describe("device tokens", () => {
  it("round-trips a minted token", async () => {
    const token = await mintDevice("secret");
    expect(await readDevice(token, "secret")).toBe(token.split(".")[0]);
  });

  it("rejects a token signed with another secret", async () => {
    expect(await readDevice(await mintDevice("secret"), "other")).toBeNull();
  });

  it("rejects a tampered device id", async () => {
    const [, signature] = (await mintDevice("secret")).split(".");
    expect(await readDevice(`somebody-else.${signature}`, "secret")).toBeNull();
  });

  it("rejects a malformed token", async () => {
    expect(await readDevice("no-dot-here", "secret")).toBeNull();
  });
});

describe("routing and CORS", () => {
  it("answers a preflight from an allowed origin", async () => {
    const response = await call({ method: "OPTIONS", body: undefined, headers: { Origin: APP } });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("omits CORS headers for an unknown origin", async () => {
    const response = await call({
      method: "OPTIONS",
      body: undefined,
      headers: { Origin: "https://evil.example" },
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("refuses a POST from an unknown origin before calling anything", async () => {
    const response = await call({ headers: { Origin: "https://evil.example" } });
    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("404s an unknown path", async () => {
    const response = await call({ method: "GET", body: undefined }, "https://sudonotes.com/api/v1/nope");
    expect(response.status).toBe(404);
  });

  it("serves the model catalog verbatim for the browser", async () => {
    const response = await call({ method: "GET", body: undefined, headers: { Origin: APP } }, "https://sudonotes.com/api/v1/models");
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    // The desktop client parses models.dev's own shape, so it must survive intact.
    expect(await response.json()).toEqual({ deepseek: { models: {} } });
  });
});

describe("request validation", () => {
  const rejects = (over: Record<string, unknown>) => call({ body: body(over) });

  it("rejects a model outside the allowlist", async () => {
    expect((await rejects({ model: "gpt-4o" })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("rejects a missing model", async () => {
    expect((await rejects({ model: undefined })).status).toBe(400);
  });

  it("rejects a non-JSON body", async () => {
    expect((await call({ body: "not json" })).status).toBe(400);
  });

  it("rejects empty messages", async () => {
    expect((await rejects({ messages: [] })).status).toBe(400);
  });

  it("rejects a message missing string content", async () => {
    expect((await rejects({ messages: [{ role: "user", content: 42 }] })).status).toBe(400);
  });

  it("rejects an unknown role", async () => {
    expect((await rejects({ messages: [{ role: "tool", content: "x" }] })).status).toBe(400);
  });

  it("rejects an oversized body rather than truncating it", async () => {
    const huge = "x".repeat(Number(env.MAX_REQUEST_BYTES) + 1);
    const response = await rejects({ messages: [{ role: "user", content: huge }] });
    expect(response.status).toBe(413);
    expect(calls).toEqual([]);
  });
});

describe("browser callers", () => {
  it("requires a Turnstile token", async () => {
    const response = await call({ headers: { Origin: APP } });
    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("refuses a token Turnstile rejects", async () => {
    turnstile = false;
    const response = await call({ headers: { Origin: APP, "Cf-Turnstile-Response": "bad" } });
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(1);
  });

  it("passes a verified token through to the model", async () => {
    const response = await call({ headers: { Origin: APP, "Cf-Turnstile-Response": "good" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(APP);
  });
});

describe("completions", () => {
  it("returns the shape the desktop client parses", async () => {
    upstream = () => completion('{"tags":["bug","testing"]}');
    const response = await call();
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      choices: { message: { content: string } }[];
      usage: { prompt_tokens: number };
    };
    expect(JSON.parse(payload.choices[0].message.content)).toEqual({ tags: ["bug", "testing"] });
    expect(payload.usage.prompt_tokens).toBe(100);
  });

  it("caps the output tokens the provider may bill for", async () => {
    let sent: Record<string, unknown> = {};
    upstream = () => completion("{}");
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return completion("{}");
    });
    await call();
    expect(sent.max_tokens).toBe(Number(env.MAX_OUTPUT_TOKENS));
    expect(sent.stream).toBe(false);
  });

  it("reports upstream failure as a 502 without echoing the provider", async () => {
    upstream = () => new Response("provider exploded, key sk-live-123", { status: 500 });
    const response = await call();
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("sk-live-123");
  });

  it("survives an upstream that never answers", async () => {
    upstream = () => {
      throw new Error("connection reset");
    };
    expect((await call()).status).toBe(502);
  });

  it("rejects an invalid device token rather than ignoring it", async () => {
    const response = await call({ headers: { "X-Sudonotes-Device": "abc.def" } });
    expect(response.status).toBe(401);
  });

  it("accepts a valid device token", async () => {
    const token = await mintDevice(env.DEVICE_TOKEN_SECRET);
    expect((await call({ headers: { "X-Sudonotes-Device": token } })).status).toBe(200);
  });
});

describe("limits", () => {
  it("refuses a device once its hourly allowance is gone", async () => {
    const token = await mintDevice(env.DEVICE_TOKEN_SECRET);
    const id = (await readDevice(token, env.DEVICE_TOKEN_SECRET)) as string;
    const cap = Number(env.DEVICE_HOURLY_LIMIT);

    // Drain the window directly; driving it through fetch would add no coverage.
    const limiter = env.LIMITER.getByName(`device:${id}`);
    for (let i = 0; i < cap; i++) await limiter.consume(1, cap, 3_600_000);

    const response = await call({ headers: { "X-Sudonotes-Device": token } });
    expect(response.status).toBe(429);
    expect(calls).toEqual([]);
  });

  it("fails closed with a 503 once the daily budget is spent", async () => {
    const day = `budget:${new Date().toISOString().slice(0, 10)}`;
    const cap = Number(env.DAILY_BUDGET_MICRO_USD);
    await env.LIMITER.getByName(day).consume(cap, cap, 172_800_000);

    const response = await call();
    expect(response.status).toBe(503);
    expect(calls).toEqual([]);
  });

  it("charges the day's budget for what a call actually used", async () => {
    const day = `budget:${new Date().toISOString().slice(0, 10)}`;
    const cap = Number(env.DAILY_BUDGET_MICRO_USD);
    const before = (await env.LIMITER.getByName(day).consume(0, cap, 172_800_000)).used;

    upstream = () => completion("{}", 1_000_000, 1_000_000);
    expect((await call()).status).toBe(200);

    const after = (await env.LIMITER.getByName(day).consume(0, cap, 172_800_000)).used;
    // One million tokens each way, at the configured per-million rates.
    const expected =
      Number(env.INPUT_MICRO_USD_PER_MTOK) + Number(env.OUTPUT_MICRO_USD_PER_MTOK);
    expect(after - before).toBe(expected);
  });
});

describe("Limiter", () => {
  const fresh = () => env.LIMITER.getByName(`unit-${crypto.randomUUID()}`);

  it("allows exactly `limit` calls before refusing", async () => {
    const limiter = fresh();
    expect((await limiter.consume(1, 2, 60_000)).ok).toBe(true);
    expect((await limiter.consume(1, 2, 60_000)).ok).toBe(true);
    expect((await limiter.consume(1, 2, 60_000)).ok).toBe(false);
  });

  it("treats a zero cost as a check that does not spend", async () => {
    const limiter = fresh();
    await limiter.consume(0, 1, 60_000);
    expect((await limiter.consume(1, 1, 60_000)).ok).toBe(true);
  });

  it("rolls the window once it expires", async () => {
    const limiter = fresh();
    await limiter.consume(1, 1, 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await limiter.consume(1, 1, 60_000)).ok).toBe(true);
  });

  it("survives eviction, because the count is in storage and not memory", async () => {
    const name = `unit-${crypto.randomUUID()}`;
    await env.LIMITER.getByName(name).consume(1, 2, 60_000);
    const { evictDurableObject } = await import("cloudflare:test");
    await evictDurableObject(env.LIMITER.getByName(name));
    expect((await env.LIMITER.getByName(name).consume(1, 2, 60_000)).used).toBe(2);
  });
});
