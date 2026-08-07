const TURNSTILE_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function base64url(bytes: ArrayBuffer): string {
  const raw = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * Mint a device token: a random id plus an HMAC over it.
 *
 * This is an *identity*, not a credential. Anyone can ask for one, so it proves
 * nothing about the caller; its only job is to give a desktop install a stable
 * handle that survives an IP change, so per-device limits mean something. The
 * signature exists so callers cannot invent ids in bulk without a round trip.
 */
export async function mintDevice(secret: string): Promise<string> {
  const id = crypto.randomUUID();
  const mac = await crypto.subtle.sign("HMAC", await key(secret), new TextEncoder().encode(id));
  return `${id}.${base64url(mac)}`;
}

/** The device id from a well-formed, correctly signed token, else null. */
export async function readDevice(token: string, secret: string): Promise<string | null> {
  const split = token.lastIndexOf(".");
  if (split <= 0) return null;
  const id = token.slice(0, split);
  const given = fromBase64url(token.slice(split + 1));
  if (!given) return null;

  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", await key(secret), new TextEncoder().encode(id)),
  );
  if (given.byteLength !== expected.byteLength) return null;
  return crypto.subtle.timingSafeEqual(given, expected) ? id : null;
}

/** True when Turnstile accepts the token for this visitor. */
export async function verifyTurnstile(
  token: string,
  secret: string,
  ip: string | null,
): Promise<boolean> {
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  body.append("idempotency_key", crypto.randomUUID());

  try {
    const response = await fetch(TURNSTILE_VERIFY, { method: "POST", body });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    // A Turnstile outage must not become an open door.
    return false;
  }
}

/** A stable, non-reversible handle for an IP, so nothing identifying is stored. */
export async function hashIp(ip: string, secret: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", await key(secret), new TextEncoder().encode(ip));
  return base64url(mac).slice(0, 22);
}
