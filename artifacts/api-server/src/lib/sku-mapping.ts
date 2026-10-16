import { sql, type AnyColumn } from "drizzle-orm";
import approvedCatalog from "./approved-catalog-sku-mappings.json";

// Exact exported identifiers take precedence over generic prefix rules. This
// also handles two-character codes, mixed separators, and per-item exceptions
// without guessing a brand-wide format or dropping alphabetic product series.
export const APPROVED_CATALOG_MAPPINGS: Readonly<Record<string, Readonly<Record<string, string | null>>>> = approvedCatalog.mappings;
const approvedMappingsJson = JSON.stringify(APPROVED_CATALOG_MAPPINGS);

// Merchant-supplied supplier → store prefix correspondences. Never discard the
// manufacturer prefix or alter the full part number when reconciling an item.
export const STORE_PREFIX_MAPPINGS: Readonly<Record<string, string>> = {
  WOO: "WDS", ACD: "ACY", DTX: "DIG", EVE: "EVG", HEL: "HLR",
  KDE: "KAD", KAL: "400", KIN: "KTY", LIN: "LND", MBL: "MTB",
  MIC: "MSI", SAL: "SJM", STX: "TSU", BWL: "BLI", RVP: "RMX",
};
export const MMD_PREFIX_MAPPINGS: Readonly<Record<string, string>> = {
  AAM: "AAM", TAM: "TAM", TRP: "TRP", SCL: "SCL", MBL: "MTB",
  ACD: "ACY", EVG: "EVG", EDU: "EDU",
  MIN: "MIA", HBB: "HBB", ICM: "ICM",
};
// Match the merchant's existing store identifiers rather than renaming them.
const MMD_PREFIX_SEPARATORS: Readonly<Record<string, string>> = { EDU: "", MIN: "" };
// Walthers uses numeric manufacturer codes followed by a required hyphen.
export const WALTHERS_PREFIX_MAPPINGS: Readonly<Record<string, string>> = { "785": "WDS" };
const mappings = {
  ...Object.fromEntries(Object.values(STORE_PREFIX_MAPPINGS).map((prefix) => [prefix, prefix])),
  ...STORE_PREFIX_MAPPINGS,
};
const prefixes = Object.keys(mappings).sort((a, b) => b.length - a.length);
const supportedSuppliers = new Set(["HobbyTyme", "Heartland Hobby Wholesale"]);

export function mapSupplierSkuToStore(sku: string, supplier: string | null): string | null {
  if (!supplier) return null;
  const identifier = sku.trim();
  const itemMappings = APPROVED_CATALOG_MAPPINGS[supplier];
  if (itemMappings && Object.hasOwn(itemMappings, identifier)) return itemMappings[identifier];
  const supplierMappings = supplier === "MMD/Squadron"
    ? MMD_PREFIX_MAPPINGS
    : supplier === "Walthers" ? WALTHERS_PREFIX_MAPPINGS
    : supportedSuppliers.has(supplier) ? mappings : null;
  if (!supplierMappings) return null;
  const supplierPrefixes = supplier === "MMD/Squadron" || supplier === "Walthers"
    ? Object.keys(supplierMappings) : prefixes;
  for (const prefix of supplierPrefixes) {
    const delimiter = supplier === "Walthers" ? "-" : "[/:\\s_-]?";
    const match = identifier.match(new RegExp(`^${prefix}${delimiter}([A-Z0-9].*)$`, "i"));
    if (match) {
      const separator = supplier === "Walthers" ? ""
        : supplier === "MMD/Squadron" ? MMD_PREFIX_SEPARATORS[prefix] ?? "-" : "-";
      return `${supplierMappings[prefix]}${separator}${match[1]}`;
    }
  }
  return null;
}

// Same conversion in SQL so searching a store-formatted SKU finds the original
// supplier records without changing their primary keys or guessing membership.
export function mappedStoreSkuExpression(sku: AnyColumn, supplier: AnyColumn) {
  // Every merchant-provided store correspondence is three characters. Use
  // string operations for the code; a large regex alternation is slow at
  // catalog scale. Reject future wider codes until both paths are adapted.
  if ([...prefixes, ...Object.keys(MMD_PREFIX_MAPPINGS), ...Object.keys(WALTHERS_PREFIX_MAPPINGS)].some((prefix) => prefix.length !== 3)) {
    throw new Error("Store SKU mappings require three-character prefixes");
  }
  const part = sql`substring(trim(${sku}) from 4)`;
  const cases = prefixes.map((prefix) => sql`WHEN ${prefix} THEN ${mappings[prefix]}`);
  const mmdCases = Object.entries(MMD_PREFIX_MAPPINGS).map(([prefix, target]) => sql`WHEN ${prefix} THEN ${target}`);
  const walthersCases = Object.entries(WALTHERS_PREFIX_MAPPINGS).map(([prefix, target]) => sql`WHEN ${prefix} THEN ${target}`);
  const separatorCases = Object.entries(MMD_PREFIX_SEPARATORS).map(([prefix, separator]) => sql`WHEN ${prefix} THEN ${separator}`);
  const supplierItems = sql`(${approvedMappingsJson}::jsonb -> ${supplier})`;
  return sql<string | null>`CASE
    WHEN ${supplierItems} ? trim(${sku}) THEN ${supplierItems} ->> trim(${sku})
    WHEN ${part} ~* ${"^[/:\\s_-]?[A-Z0-9].*$"}
    THEN (CASE
      WHEN ${supplier} IN ('HobbyTyme', 'Heartland Hobby Wholesale')
        THEN (CASE upper(left(trim(${sku}), 3)) ${sql.join(cases, sql` `)} ELSE NULL END)
      WHEN ${supplier} = 'MMD/Squadron'
        THEN (CASE upper(left(trim(${sku}), 3)) ${sql.join(mmdCases, sql` `)} ELSE NULL END)
      WHEN ${supplier} = 'Walthers' AND ${part} ~* ${"^-[A-Z0-9].*$"}
        THEN (CASE upper(left(trim(${sku}), 3)) ${sql.join(walthersCases, sql` `)} ELSE NULL END)
      ELSE NULL END)
      || (CASE WHEN ${supplier} = 'MMD/Squadron'
        THEN (CASE upper(left(trim(${sku}), 3)) ${sql.join(separatorCases, sql` `)} ELSE '-' END)
        WHEN ${supplier} = 'Walthers' THEN ''
        ELSE '-' END)
      || regexp_replace(${part}, ${"^[/:\\s_-]"}, '')
    ELSE NULL END`;
}