export const UUID: RegExp;
export const HASH: RegExp;
export function keyId(key: Uint8Array): string;
export function seal(bytes: Uint8Array, key: Uint8Array, identity: {runId: string; slot: string; keyId: string}, kdf?: unknown): Buffer;
export function open(bytes: Uint8Array, key: Uint8Array, expected: {runId: string; slot: string; keyId: string}): Buffer;
export interface BackupPayload {
  kind: "tsh-private-backup-v1"; runId: string; backupId: string; archiveKey: string;
  challenge: string; manifestSha256: string; records: {slot: string; encrypted: string}[];
}
export interface InspectedBackup extends Omit<BackupPayload, "archiveKey" | "records"> {
  archiveKey: Buffer; backupSha256: string; records: {slot: string; encrypted: Buffer; plain: Buffer}[];
}
export interface RestoreReceipt {
  kind: "tsh-independent-restore-v1"; runId: string; backupId: string;
  backupSha256: string; manifestSha256: string; challenge: string; objectCount: number;
  restoredAt: string; platform: string; mac: string;
}
export function makeBackup(payload: BackupPayload, passphrase: string): Promise<Buffer>;
export function inspectBackup(bytes: Uint8Array, passphrase: string, expectedBackupSha256: string, expectedManifestSha256: string): Promise<InspectedBackup>;
export type ReceiptBinding = Pick<InspectedBackup, "runId" | "backupId" | "backupSha256" | "manifestSha256" | "challenge" | "archiveKey"> & { records: readonly unknown[] };
export function signRestoreReceipt(payload: ReceiptBinding, platform: string): RestoreReceipt;
export function verifyRestoreReceipt(receipt: RestoreReceipt, payload: ReceiptBinding): void;
