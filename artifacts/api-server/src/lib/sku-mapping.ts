import { sql, type AnyColumn } from "drizzle-orm";
import approvedCatalog from "./approved-catalog-sku-mappings.json";
import ruleData from "./sku-candidate-rules.json";
import { BLOCKED_SOURCE_PAIRS, mappingHold, REJECTED_MAPPINGS } from "./supplier-mapping-policy";

export const APPROVED_CATALOG_MAPPINGS: Readonly<Record<string, Readonly<Record<string, string | null>>>> = approvedCatalog.mappings;
export type RuleDecision = "KEEP" | "MODIFY" | "REMOVE" | "REVIEW";
const supplierNames: Record<string, string> = {
  HRT: "Heartland Hobby Wholesale", HOB: "HobbyTyme", MMD: "MMD/Squadron", WAL: "Walthers",
};
export const CANDIDATE_RULES = ruleData.map(([supplier, source, target, separator, decision]) => ({
  supplier: supplierNames[supplier], source, target, separator,
  decision: decision as RuleDecision, id: `${supplier}:${source}`,
}));
if (CANDIDATE_RULES.length !== 72 || CANDIDATE_RULES.some(r => r.source.length !== 3)) {
  throw new Error("SKU candidate rule configuration is invalid");
}
// Compatibility correspondence exports; never used for automatic alias injection.
export const STORE_PREFIX_MAPPINGS: Readonly<Record<string, string>> = Object.fromEntries(
  CANDIDATE_RULES.filter(r => r.supplier === "HobbyTyme" && r.source !== r.target).map(r => [r.source, r.target]));
export const MMD_PREFIX_MAPPINGS: Readonly<Record<string, string>> = Object.fromEntries(
  CANDIDATE_RULES.filter(r => r.supplier === "MMD/Squadron").map(r => [r.source, r.target]));
export const WALTHERS_PREFIX_MAPPINGS = { "785": "WDS" };
export function candidateRule(sku: string, supplier: string | null) {
  if (!supplier) return null;
  const r = CANDIDATE_RULES.find(r => r.supplier === supplier && r.source === sku.trim().slice(0, 3).toUpperCase());
  if (!r) return null;
  const match = sku.trim().match(new RegExp(`^${r.source}${supplier === "Walthers" ? "-" : "[/:\\s_-]?"}([A-Z0-9].*)$`, "i"));
  return match ? { ...r, part: match[1] } : null;
}
/** No positive lookup occurs before the central source gate. Never verification. */
export function mapSupplierSkuToStore(sku: string, supplier: string | null, options: { includeReview?: boolean } = {}): string | null {
  if (!supplier || mappingHold(supplier, sku)) return null;
  const identifier = sku.trim();
  const items = APPROVED_CATALOG_MAPPINGS[supplier];
  if (items && Object.hasOwn(items, identifier)) return items[identifier]; // null is terminal
  const r = candidateRule(identifier, supplier);
  if (!r || r.decision === "REMOVE" || (r.decision === "REVIEW" && !options.includeReview)) return null;
  return `${r.target}${r.separator}${r.part}`;
}
/** Explicit evidence channel. Its targets are not usable availability matches. */
export function mappingDiagnostics(sku: string, supplier: string) {
  const hold = mappingHold(supplier, sku); // gate checked even for evidence
  const identifier = sku.trim();
  const r = candidateRule(identifier, supplier);
  const rejected = supplier === "MMD/Squadron" ? REJECTED_MAPPINGS[identifier.toUpperCase()] : null;
  const exact = APPROVED_CATALOG_MAPPINGS[supplier]?.[identifier];
  const legacyTarget = rejected ?? exact ?? (r ? `${r.target}${r.decision === "MODIFY" ? "-" : r.separator}${r.part}` : null);
  return { hold, legacyTarget, rule: r, trusted: false as const, publishable: false as const };
}
// ECMAScript trim whitespace, also used in SQL rather than btrim's space-only default.
const trimChars = " \t\r\n\f\v\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
export const normalizedSkuExpression = (sku: AnyColumn) => sql<string>`btrim(${sku}, ${trimChars})`;
export function mappedStoreSkuExpression(sku: AnyColumn, supplier: AnyColumn, options: { includeReview?: boolean } = {}) {
  const rules: Record<string, Record<string, { target: string; separator: string }>> = {};
  for (const r of CANDIDATE_RULES) {
    if (r.decision === "REMOVE" || (r.decision === "REVIEW" && !options.includeReview)) continue;
    (rules[r.supplier] ??= {})[r.source] = { target: r.target, separator: r.separator };
  }
  const identifier = normalizedSkuExpression(sku);
  const part = sql`substring(${identifier} from 4)`;
  const items = sql`(${JSON.stringify(APPROVED_CATALOG_MAPPINGS)}::jsonb -> ${supplier})`;
  const entry = sql`(${JSON.stringify(rules)}::jsonb -> ${supplier} -> upper(left(${identifier}, 3)))`;
  return sql<string | null>`CASE
    WHEN (${JSON.stringify(BLOCKED_SOURCE_PAIRS)}::jsonb -> ${supplier}) ? upper(${identifier}) THEN NULL
    WHEN ${items} ? ${identifier} THEN ${items} ->> ${identifier}
    WHEN ${identifier} !~ ${"[\n\r\u2028\u2029]"}
      AND ${part} ~* ${"^[/:\\s_-]?[A-Z0-9].*$"}
      AND (${supplier} <> 'Walthers' OR ${part} ~* ${"^-[A-Z0-9].*$"})
    THEN (${entry} ->> 'target') || (${entry} ->> 'separator')
      || regexp_replace(${part}, ${"^[/:\\s_-]"}, '')
    ELSE NULL END`;
}
