import type { SupplierSyncOffer, SupplierVisibilityRow } from "./synchronization-types";
import { moneyCents } from "./synchronization-money";
/** Exact rational unit cost: pack division does not round before comparison. */
export function verifiedUnitCost(offer: SupplierSyncOffer, currency: "USD", now: number, ageMinutes: number): SupplierVisibilityRow["verifiedCost"] {
  const c = offer.cost, observed = c ? Date.parse(c.observedAt) : NaN;
  if (!c || !c.basisVerified || c.currency !== currency || !["piece", "pack"].includes(c.basis)
    || !Number.isFinite(observed) || observed > now
    || c.basis === "pack" && (!Number.isSafeInteger(c.packSize) || (c.packSize ?? 0) < 1)) return null;
  let amount: number;
  try { amount = moneyCents(c.amount); } catch { return null; }
  if (amount <= 0) return null;
  const denominator = c.basis === "pack" ? c.packSize! : 1, n = BigInt(amount), d = BigInt(denominator);
  const scaled = (n * 10000n + d - 1n) / d; // USD, 6 decimal places, display only
  return { amount: c.amount, currency, basis: c.basis as "piece" | "pack", packSize: c.basis === "pack" ? denominator : null,
    unitCostDisplay: `${scaled / 1000000n}.${String(scaled % 1000000n).padStart(6, "0")}`,
    numeratorCents: String(amount), denominator: String(denominator), observedAt: new Date(observed).toISOString(),
    fresh: now - observed <= ageMinutes * 60000 };
}
