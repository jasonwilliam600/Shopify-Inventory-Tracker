import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback, createHmac, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { gzipSync, gunzipSync } from "node:zlib";
import { sha256, fail, MAX_FILE_BYTES } from "./secure-fs.mjs";
const scrypt = promisify(scryptCallback);
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const HASH = /^[a-f0-9]{64}$/;
const SLOT = /^(?:manifest|source|provenance|outcome-[a-f0-9-]{36}|backup-[a-f0-9-]{36}|verified-[a-f0-9-]{36}|export-[a-f0-9-]{36})$/;
const KDF = { name: "scrypt", N: 131072, r: 8, p: 1 };
export const keyId = key => sha256(key);
function keyCheck(key) { if (!(key instanceof Uint8Array) || key.length !== 32) fail("ARCHIVE_KEY_REQUIRED"); }
function contextCheck(c) {
  if (!c || !UUID.test(c.runId) || !SLOT.test(c.slot) || !HASH.test(c.keyId)
    || !HASH.test(c.sha256) || !Number.isSafeInteger(c.bytes) || c.bytes < 1 || c.bytes > MAX_FILE_BYTES) fail("ARCHIVE_ENVELOPE_CONTEXT");
}
function decode(value, expected) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail("ARCHIVE_ENCODING_INVALID");
  const b = Buffer.from(value, "base64");
  if (b.toString("base64") !== value || (expected !== undefined && b.length !== expected)) fail("ARCHIVE_ENCODING_INVALID");
  return b;
}
function aad(c, kdf) {
  return Buffer.from(JSON.stringify({ format: "tsh-encrypted-archive-v1", runId: c.runId, slot: c.slot,
    keyId: c.keyId, sha256: c.sha256, bytes: c.bytes, kdf: kdf ?? null }));
}
export function seal(bytes, key, identity, kdf) {
  keyCheck(key);
  const c = { ...identity, sha256: sha256(bytes), bytes: bytes.length };
  contextCheck(c);
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(c, kdf));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.from(JSON.stringify({ format: "tsh-encrypted-archive-v1", ...c, kdf: kdf ?? null,
    nonce: nonce.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: encrypted.toString("base64") }) + "\n");
}
export function open(bytes, key, expected) {
  keyCheck(key);
  if (bytes.length > MAX_FILE_BYTES) fail("ARCHIVE_SIZE_LIMIT");
  let e;
  try { e = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { fail("ARCHIVE_ENVELOPE_INVALID"); }
  contextCheck(e);
  if (e.format !== "tsh-encrypted-archive-v1" || e.runId !== expected.runId || e.slot !== expected.slot
    || e.keyId !== expected.keyId) fail("ARCHIVE_CONTEXT_MISMATCH");
  try {
    const cipher = createDecipheriv("aes-256-gcm", key, decode(e.nonce, 12));
    cipher.setAAD(aad(e, e.kdf)); cipher.setAuthTag(decode(e.tag, 16));
    const result = Buffer.concat([cipher.update(decode(e.ciphertext)), cipher.final()]);
    if (result.length !== e.bytes || sha256(result) !== e.sha256) fail("ARCHIVE_CONTENT_MISMATCH");
    return result;
  } catch { fail("ARCHIVE_DECRYPTION_FAILED"); }
}
async function passphraseKey(passphrase, salt) {
  if (typeof passphrase !== "string" || passphrase.length < 16 || passphrase.length > 1024) fail("BACKUP_PASSPHRASE_LENGTH");
  return scrypt(passphrase, salt, 32, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 256 * 1024 * 1024 });
}
export async function makeBackup(payload, passphrase) {
  const salt = randomBytes(32), key = await passphraseKey(passphrase, salt);
  try {
    return seal(gzipSync(Buffer.from(JSON.stringify(payload)), { level: 6 }), key,
      { runId: payload.runId, slot: `backup-${payload.backupId}`, keyId: keyId(key) },
      { ...KDF, salt: salt.toString("base64") });
  } finally { key.fill(0); }
}
/** Requires independently recorded expected hashes; returns no import permission. */
export async function inspectBackup(bytes, passphrase, expectedBackupSha256, expectedManifestSha256) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_FILE_BYTES) fail("ARCHIVE_SIZE_LIMIT");
  if (!HASH.test(expectedBackupSha256) || !HASH.test(expectedManifestSha256) || sha256(bytes) !== expectedBackupSha256) fail("BACKUP_HASH_MISMATCH");
  let e;
  try { e = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { fail("BACKUP_FORMAT_INVALID"); }
  const kdf = e.kdf;
  if (!kdf || kdf.name !== KDF.name || kdf.N !== KDF.N || kdf.r !== KDF.r || kdf.p !== KDF.p) fail("BACKUP_KDF_INVALID");
  const key = await passphraseKey(passphrase, decode(kdf.salt, 32));
  let decoded;
  try {
    const compressed = open(bytes, key, { runId: e.runId, slot: e.slot, keyId: keyId(key) });
    decoded = JSON.parse(gunzipSync(compressed, { maxOutputLength: MAX_FILE_BYTES }).toString("utf8"));
  } catch { fail("BACKUP_DECRYPTION_FAILED"); } finally { key.fill(0); }
  if (decoded.kind !== "tsh-private-backup-v1" || !UUID.test(decoded.runId) || !UUID.test(decoded.backupId)
    || e.runId !== decoded.runId || e.slot !== `backup-${decoded.backupId}` || !HASH.test(decoded.challenge)
    || decoded.manifestSha256 !== expectedManifestSha256 || !Array.isArray(decoded.records)
    || decoded.records.length < 3 || decoded.records.length > 10000) fail("BACKUP_PAYLOAD_INVALID");
  const archiveKey = decode(decoded.archiveKey, 32), ids = new Set(), records = [];
  try {
    for (const item of decoded.records) {
      if (!SLOT.test(item.slot) || /^(backup|verified|export)-/.test(item.slot) || ids.has(item.slot)) fail("BACKUP_RECORDS_INVALID");
      ids.add(item.slot);
      const encrypted = decode(item.encrypted), plain = open(encrypted, archiveKey,
        { runId: decoded.runId, slot: item.slot, keyId: keyId(archiveKey) });
      records.push({ slot: item.slot, encrypted, plain });
    }
    if (!["manifest", "source", "provenance"].every(s => ids.has(s))) fail("BACKUP_RECORDS_MISSING");
    const manifest = records.find(r => r.slot === "manifest").plain;
    if (sha256(manifest) !== expectedManifestSha256) fail("BACKUP_MANIFEST_MISMATCH");
    const m = JSON.parse(manifest.toString("utf8"));
    if (m.kind !== "tsh-initial-catalog-import-v1" || m.runId !== decoded.runId
      || m.receipt?.downloadSha256 !== sha256(records.find(r => r.slot === "source").plain)) fail("BACKUP_SOURCE_MISMATCH");
    return { ...decoded, archiveKey, records, backupSha256: expectedBackupSha256 };
  } catch (e) { archiveKey.fill(0); throw e; }
}
function receiptBody(p) {
  return { kind: "tsh-independent-restore-v1", runId: p.runId, backupId: p.backupId,
    backupSha256: p.backupSha256, manifestSha256: p.manifestSha256, challenge: p.challenge,
    objectCount: p.objectCount, restoredAt: p.restoredAt, platform: p.platform };
}
export function signRestoreReceipt(payload, platform) {
  const body = receiptBody({ ...payload, objectCount: payload.records.length, restoredAt: new Date().toISOString(), platform });
  const mac = createHmac("sha256", payload.archiveKey).update("tsh-independent-restore-v1\n").update(JSON.stringify(body)).digest("hex");
  return { ...body, mac };
}
export function verifyRestoreReceipt(receipt, payload) {
  const body = receiptBody(receipt);
  const expected = createHmac("sha256", payload.archiveKey).update("tsh-independent-restore-v1\n").update(JSON.stringify(body)).digest();
  if (receipt.kind !== "tsh-independent-restore-v1" || body.runId !== payload.runId || body.backupId !== payload.backupId
    || body.backupSha256 !== payload.backupSha256 || body.manifestSha256 !== payload.manifestSha256
    || body.challenge !== payload.challenge || body.objectCount !== payload.records.length
    || !["win32", "linux", "darwin"].includes(body.platform) || !Number.isFinite(Date.parse(body.restoredAt))
    || !HASH.test(receipt.mac) || !timingSafeEqual(Buffer.from(receipt.mac, "hex"), expected)) fail("BACKUP_RECEIPT_INVALID");
}
