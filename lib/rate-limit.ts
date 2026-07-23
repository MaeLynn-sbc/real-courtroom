import { env } from "@/lib/env";

// In-memory, fixed-window limiter — sufficient for this app's single-instance
// deployment (see docs/DEPLOYMENT.md). Does NOT work across multiple
// instances/serverless invocations, since each process has its own Map; a
// horizontally-scaled deployment would need a shared store (Redis) instead.
// Cached on globalThis the same way lib/prisma.ts caches its client, so Fast
// Refresh in dev doesn't reset counters on every module reload.

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const globalForRateLimit = globalThis as unknown as {
  rateLimitStore: Map<string, RateLimitEntry> | undefined;
};

const store = globalForRateLimit.rateLimitStore ?? new Map<string, RateLimitEntry>();

if (env.NODE_ENV !== "production") {
  globalForRateLimit.rateLimitStore = store;
}

// Opportunistic cleanup so an attacker cycling through many distinct keys
// (e.g. many fake emails) can't grow the Map unboundedly.
const MAX_STORE_SIZE = 10_000;

function cleanupIfOversized(now: number, windowMs: number): void {
  if (store.size > MAX_STORE_SIZE) {
    for (const [entryKey, entry] of store) {
      if (now - entry.windowStart >= windowMs) {
        store.delete(entryKey);
      }
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

// Checks the limit and records this call as an attempt in one step. Use for
// resources where every call (success or failure) should count against the
// quota, e.g. an expensive report export.
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  cleanupIfOversized(now, windowMs);

  const entry = store.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    store.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (entry.count >= limit) {
    return { allowed: false, retryAfterMs: windowMs - (now - entry.windowStart) };
  }

  entry.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

// Read-only check that does not record an attempt. Pair with
// recordRateLimitFailure for resources where only failures should count
// against the quota, e.g. login brute-force protection — a legitimate user
// logging in successfully many times shouldn't creep toward the same limit
// that blocks a credential-stuffing attempt.
export function peekRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    return { allowed: true, retryAfterMs: 0 };
  }

  if (entry.count >= limit) {
    return { allowed: false, retryAfterMs: windowMs - (now - entry.windowStart) };
  }

  return { allowed: true, retryAfterMs: 0 };
}

export function recordRateLimitFailure(key: string, windowMs: number): void {
  const now = Date.now();
  cleanupIfOversized(now, windowMs);

  const entry = store.get(key);
  if (!entry || now - entry.windowStart >= windowMs) {
    store.set(key, { count: 1, windowStart: now });
    return;
  }
  entry.count += 1;
}
