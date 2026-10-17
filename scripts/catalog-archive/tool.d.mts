import type { InspectedBackup, RestoreReceipt } from "./format.mjs";
export function restoreVerifiedBackup(payload: InspectedBackup, output: string): Promise<RestoreReceipt>;
export function recoverEncryptedArchive(payload: InspectedBackup, backupBytes: Uint8Array,
  output: string, keyRoot: string, workspace: string): Promise<void>;
export function main(args?: string[]): Promise<Record<string, unknown>>;
export function passphrasePrompt(): Promise<string>;
