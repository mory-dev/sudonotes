import { DurableObject } from "cloudflare:workers";

export interface Usage {
  ok: boolean;
  used: number;
  limit: number;
  /** Unix ms at which the current window rolls over. */
  resetAt: number;
}

/**
 * A fixed-window counter, one instance per subject. The Worker names instances
 * `device:<id>`, `ip:<hash>` and `budget:<yyyy-mm-dd>`; the class itself is
 * deliberately ignorant of what it is counting, so request counts (cost 1) and
 * spend (cost in micro-dollars) share the same implementation.
 *
 * The budget instance is a single global hot object. That is unavoidable — a
 * spend ceiling is global state by definition — but it only sees traffic that
 * has already survived the per-device and per-IP limits.
 */
export class Limiter extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS counter (
           id INTEGER PRIMARY KEY CHECK (id = 1),
           used INTEGER NOT NULL,
           reset_at INTEGER NOT NULL
         )`,
      );
    });
  }

  /**
   * Add `cost` to the window and report whether the subject is within `limit`.
   *
   * A zero cost is a pure check, which is how spend is tested before a call is
   * made and charged after. Going over is allowed to land — the overshoot of a
   * single request is bounded, and the next caller is refused.
   */
  consume(cost: number, limit: number, windowMs: number): Usage {
    const now = Date.now();
    const row = this.ctx.storage.sql
      .exec<{ used: number; reset_at: number }>("SELECT used, reset_at FROM counter WHERE id = 1")
      .toArray()[0];

    let used = row?.used ?? 0;
    let resetAt = row?.reset_at ?? 0;
    if (!row || now >= resetAt) {
      used = 0;
      resetAt = now + windowMs;
    }

    // Report the limit against the state *before* this call, so a request that
    // exhausts the window still succeeds and only the following one is refused.
    const ok = used < limit;
    used += cost;

    this.ctx.storage.sql.exec(
      `INSERT INTO counter (id, used, reset_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET used = excluded.used, reset_at = excluded.reset_at`,
      used,
      resetAt,
    );

    return { ok, used, limit, resetAt };
  }
}
