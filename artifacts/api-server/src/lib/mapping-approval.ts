/** Four-table audited mapping workflow. Injected SQL only; no Shopify or imports. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ImportPool } from "./shopify-catalog-importer";
import { mappingHold } from "./supplier-mapping-policy";
import { digest } from "./synchronization-plan";
import { SYNC_SUPPLIERS } from "./synchronization-types";
import { WorkflowError, type MappingReviewer } from "./reviewer-authorization";

export const approveMappingInput = z.object({
  supplier: z.enum(SYNC_SUPPLIERS), originalSku: z.string().min(1).max(300),
  variantId: z.string().regex(/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/),
  expectedVersion: z.number().int().positive().nullable(),
  identityFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  sourceIdentityFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  identityConfirmed: z.literal(true), unitConfirmed: z.literal(true),
  reason: z.string().trim().min(12).max(2000),
  costConfirmed: z.boolean().default(false),
  costBasis: z.enum(["piece", "pack", "unknown"]).default("unknown"),
  packSize: z.number().int().positive().max(100000).nullable().default(null),
  costEvidence: z.string().trim().max(2000).default(""),
  expectedCostAmount: z.string().nullable().default(null),
}).strict();
export const revokeMappingInput = z.object({
  supplier: z.enum(SYNC_SUPPLIERS), originalSku: z.string().min(1).max(300),
  expectedVersion: z.number().int().positive(), reason: z.string().trim().min(12).max(2000),
}).strict();
export const CATALOG_REVIEW_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export function catalogFresh(value: Date | string, now = Date.now()): boolean {
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time <= now && now - time <= CATALOG_REVIEW_MAX_AGE_MS;
}
export interface CatalogRecord {
  shop_domain: string; variant_gid: string; product_gid: string; inventory_item_gid: string | null;
  sku: string | null; title: string; vendor: string | null; selected_options: { name: string; value: string }[];
  identity_fingerprint: string; live_verified_at: Date | string; active: boolean;
}
export interface DecisionRecord {
  id: string; supplier_id: typeof SYNC_SUPPLIERS[number]; original_supplier_sku: string; shop_domain: string;
  variant_gid: string; state: string; version: string | number;
  product_identity_snapshot: Record<string, unknown>; selling_unit_snapshot: Record<string, unknown>;
}
export interface SupplierRecord {
  supplier: typeof SYNC_SUPPLIERS[number]; sku: string; product_name: string; supplier_stock: number | null;
  supplier_status: string; supplier_price: number | null; supplier_updated_at: Date | string | null;
  imported_fields: Record<string, unknown>;
}
export const supplierIdentityFingerprint = (s: Pick<SupplierRecord, "supplier" | "sku" | "product_name">) =>
  digest({ supplier: s.supplier, originalSku: s.sku, productName: s.product_name });
interface MappingSqlClient {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
  release(): void;
}
function reject(code: string, status = 409): never { throw new WorkflowError(code, status); }
export function configuredShop(): string {
  const value = (process.env.SHOPIFY_SHOP ?? "").replace(/^https:\/\//, "").replace(/\/$/, "");
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(value)) reject("SHOP_BINDING_NOT_CONFIGURED", 503);
  return value;
}
export class MappingApprovalRepository {
  constructor(readonly pool: ImportPool, readonly shop: string, readonly now: () => number = Date.now) {}
  async readData() {
    const client = await this.pool.connect() as unknown as MappingSqlClient;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SET LOCAL statement_timeout = '15s'");
      const catalog = await client.query<CatalogRecord>("SELECT * FROM shopify_variant_catalog WHERE shop_domain=$1 ORDER BY variant_gid", [this.shop]);
      const decisions = await client.query<DecisionRecord>("SELECT * FROM supplier_mapping_decisions WHERE shop_domain=$1 ORDER BY supplier_id,original_supplier_sku", [this.shop]);
      const sources = await client.query<SupplierRecord>(`SELECT supplier,sku,product_name,supplier_stock,supplier_status,supplier_price,
        supplier_updated_at,jsonb_build_object(
          'ZCMQOH',imported_fields->'ZCMQOH','On Hand',imported_fields->'On Hand',
          'quantityavailable',imported_fields->'quantityavailable','Stock Level',imported_fields->'Stock Level',
          'quantitySource',imported_fields->'quantitySource','dealerStock',imported_fields->'dealerStock'
        ) AS imported_fields FROM supplier_inventory WHERE supplier=ANY($1::text[]) ORDER BY supplier,sku`, [[...SYNC_SUPPLIERS]]);
      await client.query("COMMIT");
      return { catalog: catalog.rows, decisions: decisions.rows, sources: sources.rows };
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async approve(raw: unknown, reviewer: MappingReviewer) {
    const parsed = approveMappingInput.safeParse(raw);
    if (!parsed.success) reject("INVALID_MAPPING_APPROVAL", 400);
    const input = parsed.data;
    // No generic approval, exact override or prefix fallback can clear a hold.
    // Individually authorized resolutions remain a separate, unexposed workflow.
    if (mappingHold(input.supplier, input.originalSku)) reject("PROTECTED_SOURCE_HOLD");
    if (input.costConfirmed && (input.costEvidence.length < 12 || input.costBasis === "unknown"
      || (input.costBasis === "pack" && input.packSize === null))) reject("COST_UNIT_EVIDENCE_REQUIRED", 400);
    return this.change(input, reviewer, "approve");
  }
  async revoke(raw: unknown, reviewer: MappingReviewer) {
    const parsed = revokeMappingInput.safeParse(raw);
    if (!parsed.success) reject("INVALID_MAPPING_REVOCATION", 400);
    return this.change(parsed.data, reviewer, "revoke");
  }
  private async change(input: z.infer<typeof approveMappingInput> | z.infer<typeof revokeMappingInput>,
    reviewer: MappingReviewer, action: "approve" | "revoke") {
    if (!reviewer.issuer || !reviewer.subject) reject("REVIEWER_PERMISSION_REQUIRED", 403);
    const client = await this.pool.connect() as unknown as MappingSqlClient;
    let committing = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query("SET LOCAL statement_timeout = '15s'");
      const previous = await client.query<DecisionRecord & { document: Record<string, unknown> }>(
        `SELECT d.*,to_jsonb(d) AS document FROM supplier_mapping_decisions d
         WHERE supplier_id=$1 AND original_supplier_sku=$2 AND shop_domain=$3 FOR UPDATE`,
        [input.supplier, input.originalSku, this.shop]);
      const old = previous.rows[0];
      if ((old ? Number(old.version) : null) !== input.expectedVersion) reject("MAPPING_REVISION_CHANGED");
      if (action === "revoke" && !old) reject("MAPPING_NOT_FOUND", 404);
      const id = old?.id ?? randomUUID(), version = Number(old?.version ?? 0) + 1;
      let identity = old?.product_identity_snapshot, unit = old?.selling_unit_snapshot, variant = old?.variant_gid;
      let evidence: Record<string, unknown> = { reviewReason: input.reason };
      if (action === "approve") {
        const approval = input as z.infer<typeof approveMappingInput>;
        const baseHolds = await client.query("SELECT * FROM tsh_mapping_base_holds($1,$2)", [input.supplier, input.originalSku]);
        if (baseHolds.rows.length || mappingHold(input.supplier, input.originalSku)) reject("PROTECTED_SOURCE_HOLD");
        const result = await client.query<CatalogRecord>(
          "SELECT * FROM shopify_variant_catalog WHERE shop_domain=$1 AND variant_gid=$2 FOR SHARE", [this.shop, approval.variantId]);
        const c = result.rows[0];
        if (!c || !c.active || !c.inventory_item_gid || !catalogFresh(c.live_verified_at, this.now())) reject("CURRENT_VERIFIED_CATALOG_REQUIRED");
        if (c.identity_fingerprint !== approval.identityFingerprint) reject("CATALOG_IDENTITY_CHANGED");
        if (!c.sku?.trim()) reject("MISSING_SHOPIFY_SKU");
        const duplicates = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM shopify_variant_catalog WHERE shop_domain=$1 AND tsh_mapping_normalize_sku(sku)=tsh_mapping_normalize_sku($2)",
          [this.shop, c.sku]);
        if (duplicates.rows[0]?.count !== "1") reject("DUPLICATE_SHOPIFY_SKU");
        const sourceResult = await client.query<SupplierRecord>(
          "SELECT * FROM supplier_inventory WHERE supplier=$1 AND sku=$2 FOR SHARE", [input.supplier, input.originalSku]);
        const source = sourceResult.rows[0];
        if (!source) reject("SUPPLIER_SOURCE_NOT_FOUND");
        if (approval.sourceIdentityFingerprint !== supplierIdentityFingerprint(source)) reject("SUPPLIER_IDENTITY_CHANGED_REVIEW_AGAIN");
        const price = String(source.supplier_price ?? "");
        if (approval.costConfirmed && (!/^\d+(\.\d{1,2})?$/.test(price) || Number(price) <= 0)) reject("VERIFIED_COST_NOT_AVAILABLE");
        if (approval.costConfirmed && approval.expectedCostAmount !== Number(price).toFixed(2)) reject("SUPPLIER_COST_CHANGED_REVIEW_AGAIN");
        variant = c.variant_gid;
        identity = { shop_domain: this.shop, variant_gid: c.variant_gid, product_gid: c.product_gid, sku: c.sku,
          selected_options: c.selected_options, identity_fingerprint: c.identity_fingerprint,
          inventory_item_gid: c.inventory_item_gid, title: c.title, vendor: c.vendor };
        unit = { confirmed: true, retail_units_per_supplier_unit: 1, unit_label: "individual_piece",
          sourceIdentityFingerprint: supplierIdentityFingerprint(source),
          cost: approval.costConfirmed ? { amount: Number(price).toFixed(2), basis: approval.costBasis,
            packSize: approval.costBasis === "pack" ? approval.packSize : 1,
            verifiedAt: new Date(this.now()).toISOString(), evidence: approval.costEvidence } : null };
        evidence = { ...evidence, catalogVerifiedAt: c.live_verified_at, catalogFingerprint: c.identity_fingerprint,
          supplierRecordFingerprint: digest(source), identityConfirmed: true, sellingUnitsConfirmed: true,
          costConfirmed: approval.costConfirmed, quantityUnit: "individual_piece" };
      }
      const args = [id, input.supplier, input.originalSku, this.shop, variant, action === "approve" ? "approved" : "revoked",
        version, JSON.stringify(identity), JSON.stringify(unit)];
      const changed = old
        ? await client.query<{ document: Record<string, unknown> }>(`UPDATE supplier_mapping_decisions d SET variant_gid=$5,state=$6,version=$7,
          product_identity_snapshot=$8::jsonb,selling_unit_snapshot=$9::jsonb,updated_at=now()
          WHERE id=$1 AND supplier_id=$2 AND original_supplier_sku=$3 AND shop_domain=$4 RETURNING to_jsonb(d) AS document`, args)
        : await client.query<{ document: Record<string, unknown> }>(`INSERT INTO supplier_mapping_decisions AS d
          (id,supplier_id,original_supplier_sku,shop_domain,variant_gid,state,version,product_identity_snapshot,selling_unit_snapshot)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) RETURNING to_jsonb(d) AS document`, args);
      await client.query(`INSERT INTO supplier_mapping_audit_events
        (decision_id,decision_version,action,reviewer_issuer,reviewer_subject,request_id,reason,before_state,after_state,evidence)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb)`,
      [id, version, action, reviewer.issuer, reviewer.subject, randomUUID(), input.reason,
        old ? JSON.stringify(old.document) : null, JSON.stringify(changed.rows[0].document), JSON.stringify(evidence)]);
      committing = true;
      await client.query("COMMIT");
      return { id, version, state: action === "approve" ? "approved" : "revoked" };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (error instanceof WorkflowError) throw error;
      const code = (error as { code?: string }).code;
      if (["23505", "40001", "40P01"].includes(code ?? "")) reject("MAPPING_CONFLICT_RELOAD_REVIEW");
      if (committing) reject("MAPPING_COMMIT_OUTCOME_UNKNOWN_RELOAD_DO_NOT_RETRY", 503);
      reject("MAPPING_TRANSACTION_REJECTED", 503);
    } finally { client.release(); }
  }
}
