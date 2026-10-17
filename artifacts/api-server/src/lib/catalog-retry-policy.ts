/** Offline timing/error-metadata policy. No auth, fetch or provider installed. */
export interface CatalogThrottle { currentlyAvailable: number; restoreRate: number; requestedCost: number }
export function parseCatalogThrottle(extensions: unknown): CatalogThrottle | null {
  if (extensions === undefined) return null;
  if (!extensions || typeof extensions !== "object" || Array.isArray(extensions)) throw new Error("INVALID_THROTTLE_METADATA");
  const cost = (extensions as { cost?: unknown }).cost;
  if (cost === undefined) return null;
  if (!cost || typeof cost !== "object") throw new Error("INVALID_THROTTLE_METADATA");
  const c = cost as { requestedQueryCost?: unknown; throttleStatus?: unknown };
  if (!c.throttleStatus || typeof c.throttleStatus !== "object") throw new Error("INVALID_THROTTLE_METADATA");
  const s = c.throttleStatus as { currentlyAvailable?: unknown; restoreRate?: unknown };
  const available = s.currentlyAvailable, rate = s.restoreRate, requested = c.requestedQueryCost;
  if (typeof available !== "number" || !Number.isFinite(available) || available < 0
    || typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0
    || typeof requested !== "number" || !Number.isFinite(requested) || requested < 0) throw new Error("INVALID_THROTTLE_METADATA");
  return { currentlyAvailable: available, restoreRate: rate, requestedCost: requested };
}
export function catalogThrottleDelay(t: CatalogThrottle | null): number {
  return t ? Math.max(0, Math.ceil((t.requestedCost - t.currentlyAvailable) / t.restoreRate * 1000)) : 0;
}
export async function waitForCatalogBudget(
  delayMs: number, deadline: number, signal: AbortSignal,
  clock: { now: () => number; sleep: (ms: number, signal: AbortSignal) => Promise<void> },
): Promise<void> {
  if (signal.aborted) throw new Error("CATALOG_CANCELLED");
  if (!Number.isFinite(delayMs) || delayMs < 0 || !Number.isFinite(deadline)) throw new Error("INVALID_CATALOG_DEADLINE");
  if (delayMs >= deadline - clock.now()) throw new Error("CATALOG_DEADLINE_EXCEEDED");
  if (delayMs) await clock.sleep(delayMs, signal);
  if (signal.aborted) throw new Error("CATALOG_CANCELLED");
  if (clock.now() >= deadline) throw new Error("CATALOG_DEADLINE_EXCEEDED");
}
