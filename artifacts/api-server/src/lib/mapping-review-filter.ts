import approvedCatalog from "./approved-catalog-sku-mappings.json";
import { mappingHold } from "./supplier-mapping-policy";

const reviewFlags: Readonly<Record<string, Readonly<Record<string, string>>>> = approvedCatalog.reviewFlags;

/** Read-only review categories overlap; they never change a row's safety status. */
export function matchesMappingReview(
  row: { supplier: string; originalSku: string; mappingStatus: string },
  status: string,
): boolean {
  if (status === "held") return mappingHold(row.supplier, row.originalSku) !== null;
  if (status === "flagged") {
    return Object.hasOwn(reviewFlags[row.supplier] ?? {}, row.originalSku.trim().toUpperCase());
  }
  return status === "all" || row.mappingStatus === status;
}
