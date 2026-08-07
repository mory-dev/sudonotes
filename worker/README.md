# sudonotes API

The Cloudflare Worker behind `https://sudonotes.com/api/v1/*`. It holds the
provider key so the apps never do, and it is the only thing standing between a
free feature and an unbounded bill.

## Routes

| Route | Who calls it |
|---|---|
| `POST /api/v1/chat/completions` | Both apps, for tagging, titles and analysis |
| `GET /api/v1/models` | The browser app — `models.dev` sends no CORS headers |
| `POST /api/v1/device` | A desktop install, once, to get a device id |

The completions request and response shapes are fixed by the shipped desktop
client: it sends `model`, `temperature`, `response_format` and `messages`, and
reads `choices[0].message.content`. Both are covered by tests, because changing
either one breaks a version of the app that is already on someone's machine.

`/api/v1/models` is a verbatim pass-through of `models.dev/api.json`. The
desktop client parses that shape itself, so normalising it here would fork the
catalog between the two apps.

## How abuse is actually contained

Four independent limits, in the order they apply:

1. **Origin allowlist** — a browser request from anywhere but our own origins is
   refused outright, before Turnstile is consulted.
2. **Turnstile** — required for every browser call. Desktop calls have no
   `Origin` and are held to the counters below instead.
3. **Per-device and per-IP counters** — fixed hourly windows in a Durable
   Object.
4. **A daily spend ceiling** — checked before each call and charged after it,
   from the token counts the provider reports. When the day's budget is gone the
   Worker returns `503` and the client falls back to local tagging.

The device token is deliberately **not** a credential. Anyone can ask for one,
so it proves nothing; it exists to give a desktop install a stable handle that
survives an IP change. The counters and the ceiling are the real controls.

Note content is never logged. The only things written to logs are token counts,
cost, and the model name.

## Deploying

Requires a Cloudflare account with `sudonotes.com` on it.

```bash
cd worker && npm install
```

Set the three secrets — they exist only on Cloudflare, never in the repo:

```bash
npx wrangler secret put DEEPSEEK_API_KEY
```

```bash
npx wrangler secret put TURNSTILE_SECRET
```

```bash
npx wrangler secret put DEVICE_TOKEN_SECRET
```

`DEVICE_TOKEN_SECRET` is an HMAC key — any long random string works, and
rotating it invalidates every issued device id. Then:

```bash
npx wrangler deploy
```

Add the route `sudonotes.com/api/*` to the Worker in the Cloudflare dashboard,
and create a Turnstile widget for `app.sudonotes.com` whose secret is the one
above.

## Locally

Copy `.dev.vars.example` to `.dev.vars` and run:

```bash
npx wrangler dev
```

Point the desktop app at it with `SUDONOTES_API_BASE=http://localhost:8787/api/v1`.

## Tests

```bash
cd worker && npm test
```

The suite stubs the network, so no key is needed and no request leaves the
machine. It covers the client-contract shapes, the origin and Turnstile gates,
validation, the fallback status codes, and every limit.

## Tuning

The ceilings live in `wrangler.jsonc` as plain vars — hourly request limits, the
daily budget in micro-dollars, and the provider's per-million-token prices used
to charge it. Update the prices when upstream pricing moves, or the budget will
drift from what is actually being spent.
