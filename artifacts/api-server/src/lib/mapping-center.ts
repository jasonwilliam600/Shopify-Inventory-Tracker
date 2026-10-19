/** Historical proposal evaluation only. Never imported by ingestion or publishing. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, lstat, realpath, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { mappingHold, COLLISION_HISTORY_SOURCES } from "./supplier-mapping-policy";
import { APPROVED_CATALOG_MAPPINGS, CANDIDATE_RULES } from "./sku-mapping";
import type { CatalogVariant } from "./supplier-availability";
import type { MappingReviewer } from "./reviewer-authorization";

export interface CenterSource { supplier: string; sku: string; title: string | null }
export const proposalInput = z.object({
  kind: z.enum(["rule", "individual"]),
  supplier: z.string().max(200),
  incoming: z.string().trim().max(30).default(""),
  destination: z.string().trim().max(30).default(""),
  originalSku: z.string().max(300).default(""),
  catalogKey: z.string().max(100).default(""),
  reason: z.string().trim().min(12).max(2000),
  identityChecked: z.literal(true),
  unitChecked: z.literal(true),
}).strict().superRefine((v, ctx) => {
  const prefix = /^[A-Za-z0-9][A-Za-z0-9 /:_-]{0,29}$/;
  if (v.kind === "rule" && (!prefix.test(v.incoming) || !prefix.test(v.destination)))
    ctx.addIssue({ code: "custom", message: "Both literal prefixes are required." });
  if (v.kind === "individual" && (!v.supplier || !v.originalSku || !v.catalogKey))
    ctx.addIssue({ code: "custom", message: "Select a supplier product and historical destination." });
});
export function transformPrefix(sku: string, incoming: string, destination: string) {
  // Literal prefix replacement, including explicitly entered separators. No wildcard expansion.
  const source = sku.trim(), prefix = incoming.trim();
  if (!prefix || !source.toUpperCase().startsWith(prefix.toUpperCase()) || source.length === prefix.length) return null;
  return destination.trim() + source.slice(prefix.length);
}
export function ruleConflicts(supplier: string, incoming: string, destination: string) {
  return CANDIDATE_RULES.filter(r => (!supplier || r.supplier === supplier)
    && (incoming.toUpperCase().startsWith(r.source) || r.source.startsWith(incoming.toUpperCase())))
    .map(r => `${r.supplier}: ${r.source} → ${r.target}${r.separator} (${r.decision})${
      r.target + r.separator === destination.toUpperCase() ? " — overlapping existing rule" : " — conflicting destination"}`);
}
export function evaluateRule(sources: CenterSource[], variants: CatalogVariant[], incoming: string, destination: string) {
  const exactTargets = new Map<string, Map<string, Set<string>>>();
  for (const [supplier, overrides] of Object.entries(APPROVED_CATALOG_MAPPINGS)) {
    const targets = new Map<string, Set<string>>();
    for (const [sku, target] of Object.entries(overrides)) if (target) {
      const key = target.toUpperCase(), entries = targets.get(key) ?? new Set<string>();
      entries.add(sku); targets.set(key, entries);
    }
    exactTargets.set(supplier, targets);
  }
  const catalog = new Map<string, CatalogVariant[]>();
  for (const variant of variants) {
    if (!variant.sku) continue;
    const key = variant.sku.toUpperCase();
    catalog.set(key, [...(catalog.get(key) ?? []), variant]);
  }
  const transformed = sources.map(s => transformPrefix(s.sku, incoming, destination));
  const counts = new Map<string, number>();
  sources.forEach((s, i) => {
    const target = transformed[i];
    if (target) {
      const key = `${s.supplier}\0${target.toUpperCase()}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  });
  return sources.map((s, i) => {
    const proposedSku = transformed[i] ?? "";
    const matches = catalog.get(proposedSku.toUpperCase()) ?? [];
    const hold = mappingHold(s.supplier, s.sku);
    const overrides = APPROVED_CATALOG_MAPPINGS[s.supplier] ?? {};
    const override = Object.hasOwn(overrides, s.sku.trim());
    const collision = (counts.get(`${s.supplier}\0${proposedSku.toUpperCase()}`) ?? 0) > 1;
    const competitors = exactTargets.get(s.supplier)?.get(proposedSku.toUpperCase());
    const competingException = Boolean(competitors && (competitors.size > 1 || !competitors.has(s.sku.trim())));
    const knownCollision = s.supplier === "MMD/Squadron" && COLLISION_HISTORY_SOURCES.has(s.sku.trim().toUpperCase());
    const targetTitle = matches.length === 1 ? matches[0].title : "";
    const scale = (text: string) => text.match(/\b1\s*[:/]\s*(\d+)\b/)?.[1];
    const size = (text: string) => text.match(/\b(\d+(?:\.\d+)?)\s*(ml|mm|cm|oz|inches)\b/i)?.[0].toLowerCase().replace(/\s/g, "");
    const mismatch = [
      ...(scale(s.title ?? "") && scale(targetTitle) && scale(s.title!) !== scale(targetTitle) ? ["Scale mismatch."] : []),
      ...(size(s.title ?? "") && size(targetTitle) && size(s.title!) !== size(targetTitle) ? ["Size mismatch."] : []),
    ];
    const warnings = [
      ...(hold ? [`Protected ${hold.status}: ${hold.reason}`] : []),
      ...(override ? ["Existing individual exception takes precedence; this rule cannot replace it."] : []),
      ...(!proposedSku || !matches.length ? ["Historical destination missing."] : []),
      ...(matches.length > 1 ? ["Duplicate historical SKU; destination is ambiguous."] : []),
      ...(collision ? ["Same-supplier destination collision; overlapping stock must not be combined."] : []),
      ...(competingException ? ["Another individual exception targets this destination; review stock overlap."] : []),
      ...(knownCollision ? ["Known source collision history requires individual review."] : []),
      ...mismatch,
      ...(!s.title ? ["Supplier product title is unavailable."] : []),
      "Manufacturer, scale, size and selling unit require individual verification.",
    ];
    const blocked = Boolean(hold || override || collision || competingException || knownCollision || mismatch.length || matches.length !== 1);
    return { supplier: s.supplier, originalSku: s.sku, supplierTitle: s.title, proposedSku,
      catalogTitle: matches.length === 1 ? matches[0].title : null,
      catalogKey: matches.length === 1 ? matches[0].key : null,
      status: hold ? "protected" : blocked ? "conflict" : "review",
      warnings, historical: true, verified: false, publishable: false };
  });
}
export function individualEvidence(source: CenterSource, destination: CatalogVariant) {
  return { source, destination, hold: mappingHold(source.supplier, source.sku),
    historical: true, verified: false, publishable: false };
}

/** Private development proposal journal, not active rule configuration.
 * Exclusive immutable writes preserve reviewer evidence without a schema migration.
 * No production durability claim: publishing requires separately approved durable storage.
 */
export async function saveCenterProposal(root: string, input: z.infer<typeof proposalInput>,
  evidence: unknown, reviewer: MappingReviewer) {
  if (process.env.NODE_ENV !== "development") throw new Error("DEVELOPMENT_PROPOSAL_STORAGE_ONLY");
  const expected = "/home/runner/tsh-private-mapping-proposals";
  if (root !== expected) throw new Error("UNSAFE_PROPOSAL_PATH");
  return writePrivateProposal(root, input, evidence, reviewer);
}

/** Injected directory permits isolated filesystem testing, never exposed as an API input. */
export async function writePrivateProposal(root: string, input: z.infer<typeof proposalInput>,
  evidence: unknown, reviewer: MappingReviewer) {
  if (!path.isAbsolute(root)) throw new Error("UNSAFE_PROPOSAL_PATH");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0
    || info.uid !== process.getuid?.() || await realpath(root) !== root) throw new Error("PROPOSAL_STORAGE_NOT_PRIVATE");
  const id = randomUUID(), createdAt = new Date().toISOString();
  const data = { id, createdAt, reviewer, input, evidence, state: "proposed", active: false,
    futureImportsEnabled: false, publishable: false };
  const text = JSON.stringify(data);
  const file = await open(path.join(root, `${id}.json`), "wx", 0o600);
  try { await file.writeFile(text); await file.sync(); }
  finally { await file.close(); }
  return { id, createdAt, state: "proposed", active: false, sha256: createHash("sha256").update(text).digest("hex") };
}

export async function listCenterProposals(root: string) {
  try {
    const info = await lstat(root);
    if (info.isSymbolicLink() || (info.mode & 0o077) !== 0 || await realpath(root) !== root)
      throw new Error("PROPOSAL_STORAGE_NOT_PRIVATE");
    const files = (await readdir(root)).filter(name => /^[a-f0-9-]{36}\.json$/.test(name));
    const ordered = await Promise.all(files.map(async name => ({ name, info: await lstat(path.join(root, name)) })));
    return Promise.all(ordered.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs).slice(0, 50).map(async file => {
      if (!file.info.isFile() || file.info.isSymbolicLink() || (file.info.mode & 0o077) !== 0)
        throw new Error("PROPOSAL_FILE_NOT_PRIVATE");
      const record = JSON.parse(await readFile(path.join(root, file.name), "utf8"));
      return { id: String(record.id), createdAt: String(record.createdAt), kind: String(record.input.kind),
        summary: record.input.kind === "rule"
          ? `${record.input.supplier || "All suppliers"}: ${record.input.incoming} → ${record.input.destination}`
          : `${record.input.supplier}: ${record.input.originalSku}`, state: "proposed" };
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
