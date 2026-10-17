import { pool } from "@workspace/db";

const tables = ["shopify_variant_catalog", "supplier_mapping_decisions",
  "supplier_mapping_audit_events", "supplier_mapping_hold_resolutions"] as const;

/** Metadata SELECTs only. Table existence never unlocks approval or catalog access. */
export async function mappingStorageBlocker(): Promise<string> {
  try {
    const result = await pool.query<{ name: string; installed: boolean }>(
      "SELECT name, to_regclass('public.' || name) IS NOT NULL AS installed FROM unnest($1::text[]) AS name",
      [tables],
    );
    if (result.rows.length !== tables.length || result.rows.some(r => !r.installed)) {
      return "Mapping storage is missing or incomplete; no migration is executed by this feature.";
    }
    return "Mapping schema is installed. Save/Approve remain disabled until reviewer authentication, live identity verification and transactional approval APIs are implemented and tested.";
  } catch {
    return "Mapping storage could not be verified. Save/Approve and live catalog access remain disabled.";
  }
}
