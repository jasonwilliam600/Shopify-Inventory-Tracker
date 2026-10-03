import { sql, type AnyColumn } from "drizzle-orm";

// Merchant-supplied supplier → store prefix correspondences. Never discard the
// manufacturer prefix or alter the full part number when reconciling an item.
export const STORE_PREFIX_MAPPINGS: Readonly<Record<string, string>> = {
  WOO: "WDS", ACD: "ACY", DTX: "DIG", EVE: "EVG", HEL: "HLR",
  KDE: "KAD", KAL: "400", KIN: "KTY", LIN: "LND", MBL: "MTB",
  MIC: "MSI", SAL: "SJM", STX: "TSU", BWL: "BLI", RVP: "RMX",
};
const mappings = {
  ...Object.fromEntries(Object.values(STORE_PREFIX_MAPPINGS).map((prefix) => [prefix, prefix])),
  ...STORE_PREFIX_MAPPINGS,
};
const prefixes = Object.keys(mappings).sort((a, b) => b.length - a.length);
const supportedSuppliers = new Set(["HobbyTyme", "Heartland Hobby Wholesale"]);

export function mapSupplierSkuToStore(sku: string, supplier: string | null): string | null {
  if (!supplier || !supportedSuppliers.has(supplier)) return null;
  const identifier = sku.trim();
  for (const prefix of prefixes) {
    const match = identifier.match(new RegExp(`^${prefix}[/:\\s_-]?([A-Z0-9].*)$`, "i"));
    if (match) return `${mappings[prefix]}-${match[1]}`;
  }
  return null;
}

// Same conversion in SQL so searching a store-formatted SKU finds the original
// supplier records without changing their primary keys or guessing membership.
export function mappedStoreSkuExpression(sku: AnyColumn, supplier: AnyColumn) {
  // Every merchant-provided store correspondence is three characters. Use
  // string operations for the code; a large regex alternation is slow at
  // catalog scale. Reject future wider codes until both paths are adapted.
  if (prefixes.some((prefix) => prefix.length !== 3)) {
    throw new Error("Store SKU mappings require three-character prefixes");
  }
  const part = sql`substring(trim(${sku}) from 4)`;
  const cases = prefixes.map((prefix) => sql`WHEN ${prefix} THEN ${mappings[prefix]}`);
  return sql<string | null>`CASE WHEN ${supplier} IN ('HobbyTyme', 'Heartland Hobby Wholesale')
      AND ${part} ~* ${"^[/:\\s_-]?[A-Z0-9].*$"}
    THEN (CASE upper(left(trim(${sku}), 3)) ${sql.join(cases, sql` `)} ELSE NULL END)
      || '-' || regexp_replace(${part}, ${"^[/:\\s_-]"}, '')
    ELSE NULL END`;
}