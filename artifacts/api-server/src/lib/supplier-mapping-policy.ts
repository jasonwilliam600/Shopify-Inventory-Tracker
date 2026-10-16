import approvedCatalog from "./approved-catalog-sku-mappings.json";

// Rejected source relationships remain blocked until a corrected relationship
// has an explicit review. A raw/exact/prefix fallback cannot clear this hold.
export const REJECTED_MAPPINGS: Readonly<Record<string, string>> = {
  CPA144001: "CPP-144001", CPA72009: "CPP-72009",
  CPD72011: "CPP-72011", CPA72001: "CPP-72001",
  CPA72004: "CPP-72004", CPA72007: "CPP-72007",
  CPA72008: "CPP-72008", CPA72011: "CPP-72011",
  CPA72016: "CPP-72016", CPD72001: "CPP-72001",
  CPD72002: "CPP-72002", ICM72075: "IBG-72075",
};
const reviewFlags: Readonly<Record<string, Readonly<Record<string, string>>>> = approvedCatalog.reviewFlags;

export function mappingHold(supplier: string, sourceSku: string): { status: "rejected" | "held"; reason: string } | null {
  const identifier = sourceSku.trim().toUpperCase();
  if (supplier === "MMD/Squadron" && Object.hasOwn(REJECTED_MAPPINGS, identifier)) {
    return {
      status: "rejected",
      reason: `Rejected product relationship to ${REJECTED_MAPPINGS[identifier]}. Corrected product identity requires explicit review; exact-SKU and prefix fallback cannot clear this exclusion.`,
    };
  }
  const reason = reviewFlags[supplier]?.[identifier];
  return reason ? { status: "held", reason: `Flagged candidate: ${reason}. Not a trusted match.` } : null;
}

const flaggedKeys = Object.entries(reviewFlags).flatMap(([supplier, flags]) =>
  Object.keys(flags).map(sku => `${supplier}\0${sku.toUpperCase()}`));
export const MAPPING_POLICY_COUNTS = Object.freeze({
  rejectedMappings: Object.keys(REJECTED_MAPPINGS).length,
  flaggedCandidates: flaggedKeys.length,
  uniqueHeldSources: new Set([...flaggedKeys, ...Object.keys(REJECTED_MAPPINGS).map(sku => `MMD/Squadron\0${sku}`)]).size,
});
