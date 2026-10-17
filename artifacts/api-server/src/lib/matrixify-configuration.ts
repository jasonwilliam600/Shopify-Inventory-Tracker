/** Configuration/evidence reader only. Never creates files, definitions or permissions. */
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { SYNC_SUPPLIERS, type SyncPolicy } from "./synchronization-types";
import { SUPPLIER_METAFIELD_KEYS } from "./supplier-variant-metafields";
import { catalogFresh, configuredShop } from "./mapping-approval";
import { WorkflowError } from "./reviewer-authorization";
import { digest } from "./synchronization-plan";

export const MATRIXIFY_NAMESPACE = "tsh_inventory_sync";
const iso = z.string().datetime({ offset: true });
const positive = z.number().int().positive();
const integer = z.number().int().nonnegative();
const configSchema = z.object({
  schemaVersion: z.literal(1), shopDomain: z.string().regex(/^[a-z0-9-]+\.myshopify\.com$/),
  currency: z.literal("USD"), approvedBy: z.string().min(1), approvedAt: iso,
  location: z.object({ id: z.string().regex(/^gid:\/\/shopify\/Location\/[1-9]\d*$/),
    name: z.string().min(1).max(100).refine(s => s.trim() === s && !/[\r\n\t\[\]]/.test(s)),
    active: z.literal(true), observedAt: iso, evidenceReference: z.string().min(1) }),
  policy: z.object({
    safetyStock: integer, maxQuantity: positive, lowerBounds: z.enum(["hold", "use_floor"]),
    maxAgeMinutes: z.object(Object.fromEntries(SYNC_SUPPLIERS.map(s => [s, positive])) as Record<typeof SYNC_SUPPLIERS[number], typeof positive>),
    maxChangedVariants: positive, maxZeroedVariants: integer, maxQuantityDelta: integer,
    maxPriceChangeBasisPoints: integer, maxPlanAgeSeconds: positive.max(300),
    pricing: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("preserve") }),
      z.object({ mode: z.literal("markup"), basisPoints: integer.max(100000) }),
      z.object({ mode: z.literal("margin"), basisPoints: integer.max(9999) }),
    ]),
  }),
  pricingApproval: z.object({ approvedBy: z.string().min(1), approvedAt: iso, policyDigest: z.string().regex(/^[a-f0-9]{64}$/) }).nullable(),
  metafieldNamespaceApproval: z.object({
    approvedBy: z.string().min(1), approvedAt: iso,
    acknowledgesOtherAdminAppsAccess: z.literal(true),
    themeExposureReviewed: z.literal(true), evidenceReference: z.string().min(1),
  }).nullable(),
  metafieldObservation: z.object({
    shopDomain: z.string(), observedAt: iso, evidenceReference: z.string().min(1),
    definitions: z.array(z.object({
      namespace: z.literal(MATRIXIFY_NAMESPACE), key: z.string(), ownerType: z.literal("PRODUCTVARIANT"),
      type: z.object({ name: z.string() }),
      access: z.object({ admin: z.literal("PUBLIC_READ_WRITE"), storefront: z.literal("NONE"), customerAccount: z.literal("NONE") }),
    })),
  }).nullable(),
}).strict();
export type MatrixifyConfiguration = z.infer<typeof configSchema>;
export function validateMatrixifyConfiguration(input: unknown, shop: string, now = Date.now()) {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success || parsed.data.shopDomain !== shop) throw new WorkflowError("MATRIXIFY_CONFIGURATION_INVALID", 503);
  const cfg = parsed.data;
  if (Date.parse(cfg.approvedAt) > now || !catalogFresh(cfg.location.observedAt, now))
    throw new WorkflowError("CURRENT_LOCATION_EVIDENCE_REQUIRED", 503);
  if (cfg.policy.pricing.mode !== "preserve" && (!cfg.pricingApproval
    || cfg.pricingApproval.policyDigest !== digest(cfg.policy.pricing)
    || Date.parse(cfg.pricingApproval.approvedAt) > now)) throw new WorkflowError("APPROVED_PRICING_POLICY_REQUIRED", 503);
  return cfg;
}
export function privateMetafieldsReady(cfg: MatrixifyConfiguration, now = Date.now()) {
  const observation = cfg.metafieldObservation;
  return Boolean(cfg.metafieldNamespaceApproval && Date.parse(cfg.metafieldNamespaceApproval.approvedAt) <= now
    && observation && observation.shopDomain === cfg.shopDomain && catalogFresh(observation.observedAt, now)
    && observation.definitions.length === 5 && SUPPLIER_METAFIELD_KEYS.every((key, index) => {
      const entries = observation.definitions.filter(d => d.key === key);
      return entries.length === 1 && entries[0].type.name === (index === 0 ? "json" : "multi_line_text_field");
    }));
}
export function exportPolicy(cfg: MatrixifyConfiguration): SyncPolicy {
  return { ...cfg.policy, currency: "USD", shopDomain: cfg.shopDomain, locationId: cfg.location.id,
    selection: "combine", supplierMetafields: true };
}
export async function loadMatrixifyConfiguration(): Promise<MatrixifyConfiguration> {
  const filename = process.env.MATRIXIFY_WORKFLOW_CONFIG;
  // Existing development-only private archive is not repurposed for configuration.
  // No automatic initialization or defaults that pretend owner approval.
  if (!filename || !path.isAbsolute(filename)) throw new WorkflowError("MATRIXIFY_OWNER_CONFIGURATION_REQUIRED", 503);
  let current = path.parse(filename).root;
  for (const component of filename.slice(current.length).split(path.sep)) {
    if (!component || component === "." || component === "..") throw new WorkflowError("UNSAFE_CONFIGURATION_PATH", 503);
    current = path.join(current, component);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new WorkflowError("UNSAFE_CONFIGURATION_PATH", 503);
  }
  const stat = await lstat(filename);
  const parent = await lstat(path.dirname(filename));
  if (!stat.isFile() || stat.size > 100_000 || (stat.mode & 0o077) !== 0 || (parent.mode & 0o077) !== 0
    || stat.uid !== process.getuid?.() || parent.uid !== process.getuid?.())
    throw new WorkflowError("OWNER_ONLY_CONFIGURATION_PERMISSIONS_REQUIRED", 503);
  const handle = await open(filename, "r");
  try {
    const opened = await handle.stat();
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) throw new WorkflowError("CONFIGURATION_PATH_CHANGED", 503);
    return validateMatrixifyConfiguration(JSON.parse(await handle.readFile("utf8")), configuredShop());
  } finally { await handle.close(); }
}
