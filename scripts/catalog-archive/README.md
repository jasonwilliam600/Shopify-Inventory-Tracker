# Development-only private catalog archive

## Status and boundaries

The filesystem backend has been explicitly initialized at the approved private
development locations. The unchanged real catalog source and available provenance
have been encrypted and verified through the existing adapter. A private
`*.staging-receipt.json` records checksums and verification results; it is NOT an
import manifest or import approval.

No import manifest, portable backup or accepted independent-restore receipt exists
for this staged run. Missing provenance and full-identity reconciliation remain
blocked. The adapter is **not connected to automatic application startup**, and no
database or Shopify request was part of staging.

Backend: `artifacts/api-server/src/lib/catalog-filesystem-archive.ts`.
Operator export/receipt CLI: `artifacts/api-server/src/lib/catalog-archive-export-cli.ts`.
Portable built-in-only Node tools: this directory.

This is an additional `ProtectedManifestArchive` implementation, NOT a bypass in
the Google adapter. The Google adapter, importer, parser, reconciliation contract,
schema, supplier rules and holds are unchanged.

Validation: 15 filesystem/archive scenarios and 3 standalone CLI/terminal
scenarios passed, including >16 MiB synthetic source data and interrupted-restore
failure injection. All 42 existing offline catalog regression tests passed.
API TypeScript checking and operator CLI compilation passed. No native Windows,
real SSH transfer, actual runtime activation, or real catalog import was tested.

The owner authorized real private initialization and source/provenance staging
only. Operations below involving a validated import manifest, portable export,
independent restore or import remain **future procedures requiring the applicable
approval**. Staging neither supplies missing evidence nor authorizes an import.

## Security and limitations

- Development assertion and production/deployment environment rejection.
- Absolute canonical paths, no symlinked ancestors, no Git ancestors.
- Archive/key directories outside the workspace, served roots and deployment
  artifacts. Additional external served/build roots belong in `forbiddenRoots`.
- POSIX current-owner 0700 directories; 0600 regular files; single-link checks,
  no-follow opens, size bounds and directory-identity checks on operations.
- AES-256-GCM, fresh random nonces, authenticated run/slot/key/hash/length context.
- Exclusive temporary encrypted files, atomic create-only hard-link publication,
  file/directory fsync, exact readback; no automatic overwrite/delete.
- Identical content retries reuse the immutable object; conflicts fail.
- Encryption key injected into the library. The optional initialization tool
  writes a random 32-byte key in a DIFFERENT private directory, never stdout.
- A portable backup contains the archive records and recovery key only INSIDE a
  separate authenticated passphrase envelope. scrypt uses N=131072, r=8, p=1 and a
  fresh 32-byte salt. Passphrases must be 16+ characters; use at least five randomly
  chosen words, not a predictable sentence. Keep the passphrase outside the backup.
- Do not put passphrases in argv, environment variables, shell scripts, chat or
  logs. Interactive prompts hide input and do not keep readline history.
- SHA-256 backup and manifest hashes must come from the separately recorded export
  result/approval, not from the untrusted backup's self-declared fields.
- `readManifest()` refuses access until an authenticated full-restore receipt is
  accepted with explicit operator acknowledgement of an INDEPENDENT restore.
  Recreating a process does not remove the gate; changed/missing backup evidence
  blocks access again.
- The receipt MAC proves possession of the restored backup, NOT remote computer
  identity. A trusted human must truthfully confirm independence. An on-server
  restore is useful testing, not an actual Windows/off-workspace backup.
- No software-only immutable-file design protects against an administrator or
  malicious process with the same OS identity and key. Trusted collaborators and
  project owners remain trusted. This is not administrator-proof WORM.

No default real paths exist in the library. Suggested future paths:

```
/home/runner/tsh-private-catalog-archive    (0700; encrypted archive/backup files)
/home/runner/tsh-private-catalog-keys       (0700; separate 0600 archive.key)
```

These are outside `/home/runner/workspace`. Do not replace them with `.local/`,
`downloads/`, a symlink into the workspace, public object paths or an artifact
directory. Encryption alone does not make an unsafe directory acceptable.

## Required prerequisites before a real workflow

1. Owner approval to initialize/stage the real DEVELOPMENT archive, separately
   from any catalog import or DB access.
2. Verify the actual operator process is a development process. The initial test
   runner inherited deployment-like flags and refused operation. The runtime guard
   now requires a UUID Replit project identity, a canonical `.replit.dev` editor
   hostname and a matching development-only `REPLIT_DOMAINS` list. Any present
   deployment marker, production/unknown Node environment, unknown descriptive
   environment, or missing/conflicting workspace identity is rejected.
   `REPLIT_ENVIRONMENT=production` alone is descriptive metadata, not deployment
   authorization; only a complete positively identified editor context can pass.
   Synthetic tests use explicitly fictional child contexts. **Never unset/override
   production markers to force these tools to operate on a real target.**
3. Node.js 22+ on Windows, with Windows PowerShell and NTFS ACL support. The tool
   fails closed if it cannot establish/check owner-only ACLs.
4. OpenSSH/scp access already available on the existing Replit plan. Replit
   documents SSH for paid plans; no new plan/account is created by these tools.
   Use the exact host/port/SSH alias supplied by Replit's SSH pane; none is guessed.
5. A safe place to retain the encrypted Windows backup and recover its passphrase.

The physical Windows/SSH steps cannot be proven by a Linux-only fixture test.
They remain a user-operated rehearsal before real use. If SSH is unavailable on
the existing plan, STOP: do not copy archives into Git/Files-panel directories as
a workaround. A separately approved authenticated transfer design is then needed.

## Future initialization and staging — not executed

First compile the operator CLI OUTSIDE the repository using existing tooling:

```sh
pnpm --filter @workspace/api-server exec esbuild src/lib/catalog-archive-export-cli.ts \
  --bundle --platform=node --format=esm --outfile=/tmp/tsh-catalog-archive-export.mjs
```

After explicit real-development approval, initialize empty private locations:

```sh
node scripts/catalog-archive/tool.mjs init-server \
  --out /home/runner/tsh-private-catalog-archive \
  --key-root /home/runner/tsh-private-catalog-keys \
  --workspace /home/runner/workspace
```

An approved trusted caller would then:

1. Prepare an opaque plan through the UNCHANGED catalog preparation/reconciliation
   gates. Archive work does not certify missing provenance or renew freshness.
2. Open `CatalogFilesystemArchive` with the development assertion, approved
   workspace/forbidden roots, and the private key.
3. Call `archiveManifest(plan)`, `archiveSource(runId, exactSourceBytes)` and
   `archiveProvenance(runId, exactEvidenceBytes)`.
4. Source SHA-256 must match the manifest's parser receipt before backup export.
   Preserve the closed original evidence as received; do not fabricate fields.

No catalog-staging or import CLI is supplied by this phase. The supplied export
CLI only exports an already-staged archive or accepts a restore receipt. It has
no database client/import command.

## Export an encrypted backup — future approved action

```sh
node /tmp/tsh-catalog-archive-export.mjs export \
  --root /home/runner/tsh-private-catalog-archive \
  --key-root /home/runner/tsh-private-catalog-keys \
  --workspace /home/runner/workspace --run <RUN_UUID>
```

Type and confirm the backup passphrase at the hidden terminal prompts. Preserve
the returned filename, backup SHA-256 and manifest SHA-256 independently. No key,
passphrase or plaintext catalog is printed.

Each export has a fresh backup ID; earlier backups/bindings are never overwritten.
Exports include all archive outcome records present at that snapshot. Later
outcomes require another backup if they too must survive workspace loss.

## Download and independently restore on Windows

Replace placeholders with the exact SSH alias, export filename and recorded
hashes. These are procedure examples, not executed transfers.

Copy only the NONSECRET tool source directory to Windows (or download its three
`.mjs` files from the repository). Keep `tool.mjs`, `format.mjs` and
`secure-fs.mjs` together:

```powershell
scp -r "<SSH_ALIAS>:/home/runner/workspace/scripts/catalog-archive" "$HOME\Downloads"
$Tools = "$HOME\Downloads\catalog-archive"
$BackupDir = "$HOME\TSH-Backups-New"       # must not already exist
node "$Tools\tool.mjs" prepare-download-dir --out "$BackupDir"
scp "<SSH_ALIAS>:/home/runner/tsh-private-catalog-archive/<EXPORT_FILENAME>" "$BackupDir\"
```

The preparation command establishes and verifies a current-user-only Windows ACL.
No secret archive data is copied through a public HTTP endpoint or into the
Replit repository. Never SCP the raw key directory.

Verify the ciphertext and decrypt every record without restoring:

```powershell
node "$Tools\tool.mjs" verify --backup "$BackupDir\<EXPORT_FILENAME>" `
  --backup-sha <RECORDED_BACKUP_SHA256> --manifest-sha <APPROVED_MANIFEST_SHA256>
```

This `verify` command alone does NOT generate an independent-restore receipt.
Actually restore into a new private local folder:

```powershell
$RestoreDir = "$HOME\TSH-Restore-New"      # must not already exist
node "$Tools\tool.mjs" restore --backup "$BackupDir\<EXPORT_FILENAME>" `
  --backup-sha <RECORDED_BACKUP_SHA256> --manifest-sha <APPROVED_MANIFEST_SHA256> `
  --out "$RestoreDir"
```

Use a local NTFS directory, not a repository, web folder or shared/synced restore
folder. The restore directory holds confidential PLAINTEXT protected by its ACL.
Keep it private; the original `.tshbackup` remains encrypted.

The tool creates `manifest.json`, `catalog-source.jsonl`, `provenance.txt`,
available outcome records and LAST `restore-receipt.json`. It performs file sync
and readback. Any failure produces no success receipt; existing/partial
destinations are not reused. Choose a fresh destination after investigating.

Keep the encrypted package AND the portable tools outside Replit. Save the
passphrase separately. Losing both the workspace key and backup passphrase means
the archive cannot be recovered.

## Acknowledge the independent restore — separate explicit owner action

After the owner confirms that the actual Windows restore succeeded, transfer
only its nonsecret authenticated receipt to a unique staging filename inside the
private server archive directory:

```powershell
scp "$RestoreDir\restore-receipt.json" `
  "<SSH_ALIAS>:/home/runner/tsh-private-catalog-archive/<UNIQUE_RECEIPT_FILENAME>.json"
```

The inbound receipt is UNTRUSTED staging, not the canonical immutable approval.
Do not overwrite an earlier staging filename. On the approved development server,
ensure this newly received file has mode 0600 (SCP may create it with 0644):

```sh
chmod 600 /home/runner/tsh-private-catalog-archive/<UNIQUE_RECEIPT_FILENAME>.json
node /tmp/tsh-catalog-archive-export.mjs accept-receipt \
  --root /home/runner/tsh-private-catalog-archive \
  --key-root /home/runner/tsh-private-catalog-keys \
  --workspace /home/runner/workspace \
  --receipt /home/runner/tsh-private-catalog-archive/<UNIQUE_RECEIPT_FILENAME>.json \
  --backup <EXPORT_FILENAME> --confirm-independent-restore
```

The flag is a real operator attestation, not something automated jobs should set.
It verifies the receipt MAC, export challenge, backup hash, manifest hash and
record count, then seals an immutable accepted record. No import is executed.
The actual importer still needs all its existing approvals, reconciliation,
freshness and transaction guards.

## Workspace-loss recovery

Recovering storage is NOT restoring the application database.

1. Obtain a clean copy of this tool and the retained encrypted backup.
2. Verify the independently recorded ciphertext and manifest hashes.
3. On a separately approved replacement DEVELOPMENT workspace, upload the backup
   into a private directory outside any repository. Preserve mode 0600.
4. Run recovery with NEW, nonexisting, disjoint archive/key directories:

```sh
node scripts/catalog-archive/tool.mjs recover \
  --backup <ABSOLUTE_PRIVATE_BACKUP_PATH> \
  --backup-sha <RECORDED_BACKUP_SHA256> --manifest-sha <APPROVED_MANIFEST_SHA256> \
  --out /home/runner/tsh-recovered-archive \
  --key-root /home/runner/tsh-recovered-keys \
  --workspace /home/runner/workspace
```

Recovery restores encrypted records, the protected backup/export binding and a
separate owner-only key file. It intentionally does NOT restore accepted-backup
status automatically. Re-verify the independent copy and explicitly accept its
receipt again. Nothing runs SQL, changes supplier records, or renews old catalog
evidence/approvals.

## Failure handling and durability

Wrong key/passphrase, corrupted ciphertext, mismatched hashes, unsafe paths,
permissions, symlinks/hardlinks, missing source, missing backup or invalid receipt:
STOP. Never relax checks or bypass the backend by handing the importer raw bytes.

Interrupted encrypted writes may leave private `pending-*.enc` files. They are
not accepted records. Do not automatically delete/recover them; inspect with the
owner after stopping clients. Existing published records remain immutable.

An archive/output-record failure after a DB COMMIT is not a DB rollback. This
phase has no import executor and cannot decide/retry SQL outcomes.

Ordinary development process restarts preserve workspace files, but redeployment
and workspace/account loss are NOT covered by the local filesystem. The
independent retained backup and separately recoverable passphrase supply that
recovery path. This backend is not for unattended published production use.

## Isolated testing

Tests use fresh `/tmp/tsh-filesystem-archive-test-*` directories, synthetic
catalogs/keys and a clean child environment with no DB/Shopify credentials and
HTTP blocked. No PostgreSQL instance or catalog import is run by this suite.

```sh
pnpm --filter @workspace/api-server exec esbuild src/lib/catalog-filesystem-archive.test.ts \
  --bundle --platform=node --format=esm \
  --banner:js='import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' \
  --outfile=/tmp/tsh-filesystem-archive-tests.mjs
env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp LANG=C.UTF-8 NODE_ENV=development \
  node --import 'data:text/javascript,globalThis.fetch=()=>{throw new Error("NETWORK_FORBIDDEN_IN_OFFLINE_TESTS")}' \
  --test /tmp/tsh-filesystem-archive-tests.mjs
```

The clean environment above is for synthetic tests ONLY, never actual target
activation. Native Windows ACL/TTY/SCP execution requires a separate Windows
rehearsal; it is not claimed by Linux tests.

References: Replit SSH https://docs.replit.com/features/workspace-tools/ssh and
filesystem/publishing https://docs.replit.com/features/publishing/overview.
