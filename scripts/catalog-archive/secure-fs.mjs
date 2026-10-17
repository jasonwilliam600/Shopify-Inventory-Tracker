// Shared by the unconnected POSIX archive and independent Windows restore tool.
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export const MAX_FILE_BYTES = 256 * 1024 * 1024;
export function fail(code) { throw new Error(code); }
export function requireDevelopmentRuntime() {
  if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT
    || process.env.REPLIT_ENVIRONMENT === "production") fail("ARCHIVE_DEVELOPMENT_ONLY");
}
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const within = (root, value) => value === root || value.startsWith(root + path.sep);
export async function checkAncestors(value) {
  if (!path.isAbsolute(value) || path.resolve(value) !== value) fail("ARCHIVE_ABSOLUTE_CANONICAL_PATH_REQUIRED");
  let current = path.parse(value).root;
  for (const part of value.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const s = await fs.lstat(current);
    if (!s.isDirectory() || s.isSymbolicLink()) fail("ARCHIVE_UNSAFE_ANCESTOR");
    if (process.platform !== "win32" && (s.mode & 0o022) && !(s.mode & 0o1000)) fail("ARCHIVE_WRITABLE_ANCESTOR");
    try { await fs.lstat(path.join(current, ".git")); fail("ARCHIVE_INSIDE_GIT"); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
  }
}
export async function checkPrivateRoot(root, forbiddenRoots = []) {
  if (process.platform === "win32") fail("ARCHIVE_SERVER_REQUIRES_POSIX");
  await checkAncestors(root);
  for (const forbidden of forbiddenRoots) {
    const real = await fs.realpath(forbidden);
    if (within(real, root)) fail("ARCHIVE_FORBIDDEN_ROOT");
  }
  const s = await fs.lstat(root);
  if (s.uid !== process.getuid() || (s.mode & 0o777) !== 0o700) fail("ARCHIVE_PRIVATE_DIRECTORY_REQUIRED");
  return { dev: s.dev, ino: s.ino };
}
export async function createPrivateRoot(root, forbiddenRoots = []) {
  await checkAncestors(path.dirname(root));
  for (const forbidden of forbiddenRoots) {
    if (within(await fs.realpath(forbidden), root)) fail("ARCHIVE_FORBIDDEN_ROOT");
  }
  await fs.mkdir(root, { mode: 0o700 }); // never chmod/reuse somebody else's directory
  return checkPrivateRoot(root, forbiddenRoots);
}
function nameOnly(name) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,180}$/.test(name) || name.includes("..")) fail("ARCHIVE_INVALID_FILENAME");
}
export async function readPrivate(root, name) {
  nameOnly(name);
  const handle = await fs.open(path.join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = await handle.stat();
    if (!s.isFile() || s.uid !== process.getuid() || (s.mode & 0o777) !== 0o600 || s.nlink !== 1
      || s.size < 1 || s.size > MAX_FILE_BYTES) fail("ARCHIVE_PRIVATE_FILE_REQUIRED");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== s.size || after.size !== s.size || after.mtimeMs !== s.mtimeMs
      || after.ctimeMs !== s.ctimeMs) fail("ARCHIVE_FILE_CHANGED");
    return bytes;
  } finally { await handle.close(); }
}
export async function writeImmutable(root, name, bytes) {
  nameOnly(name);
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > MAX_FILE_BYTES) fail("ARCHIVE_SIZE_LIMIT");
  const temporary = path.join(root, `pending-${randomUUID()}.enc`);
  const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  try {
    await fs.link(temporary, path.join(root, name)); // atomic, complete, no replacement
  } finally { await fs.unlink(temporary); } // a killed process may leave encrypted pending files
  const directory = await fs.open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await directory.sync(); } finally { await directory.close(); }
  const stored = await readPrivate(root, name);
  if (sha256(stored) !== sha256(bytes)) fail("ARCHIVE_WRITE_READBACK_FAILED");
}

// Protect a FRESH independent restore directory before writing any plaintext.
// Windows NTFS ACLs, not POSIX mode bits, are the security boundary on Windows.
export async function createRestoreDirectory(root) {
  await checkAncestors(path.dirname(root));
  await fs.mkdir(root, { mode: 0o700 });
  if (process.platform === "win32") {
    const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
$p = ([Console]::In.ReadToEnd() | ConvertFrom-Json).path
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $p -AclObject $acl
$actual = Get-Acl -LiteralPath $p
$rules = @($actual.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
if (!$actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].IsInherited -or $rules[0].FileSystemRights -ne 'FullControl') { throw 'RESTORE_ACL_INVALID' }
[Console]::Write('PRIVATE_ACL_VERIFIED')
`;
    try {
      const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script],
        { input: JSON.stringify({ path: root }), encoding: "utf8", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      if (output.trim() !== "PRIVATE_ACL_VERIFIED") fail("RESTORE_ACL_UNVERIFIED");
    } catch { fail("RESTORE_WINDOWS_ACL_FAILED"); }
    if ((await fs.readdir(root)).length !== 0) fail("RESTORE_DIRECTORY_NOT_EMPTY");
  } else {
    await checkPrivateRoot(root);
  }
}
export async function writeRestoreFile(root, name, bytes) {
  nameOnly(name);
  if (process.platform === "win32") await verifyWindowsPrivacy(root);
  else await checkPrivateRoot(root);
  const handle = await fs.open(path.join(root, name),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  if (process.platform === "win32") await verifyWindowsPrivacy(path.join(root, name));
  const stored = process.platform === "win32" ? await fs.readFile(path.join(root, name)) : await readPrivate(root, name);
  if (sha256(stored) !== sha256(bytes)) fail("RESTORE_READBACK_FAILED");
}
async function verifyWindowsPrivacy(value) {
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
$p = ([Console]::In.ReadToEnd() | ConvertFrom-Json).path
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = Get-Acl -LiteralPath $p
$rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $rules.Count -lt 1) { throw 'PRIVATE_OWNER_REQUIRED' }
foreach ($rule in $rules) { if ($rule.IdentityReference.Value -ne $sid.Value -or $rule.AccessControlType -ne 'Allow') { throw 'PRIVATE_ACL_REQUIRED' } }
[Console]::Write('PRIVATE_ACL_VERIFIED')
`;
  try {
    const result = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script],
      { input: JSON.stringify({ path: value }), encoding: "utf8", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    if (result.trim() !== "PRIVATE_ACL_VERIFIED") fail("RESTORE_ACL_UNVERIFIED");
  } catch { fail("RESTORE_WINDOWS_ACL_FAILED"); }
}
export async function readPortableInput(filename) {
  if (!path.isAbsolute(filename) || path.resolve(filename) !== filename) fail("ARCHIVE_ABSOLUTE_CANONICAL_PATH_REQUIRED");
  await checkAncestors(path.dirname(filename));
  if (process.platform !== "win32") {
    await checkPrivateRoot(path.dirname(filename));
    return readPrivate(path.dirname(filename), path.basename(filename));
  }
  await verifyWindowsPrivacy(path.dirname(filename));
  await verifyWindowsPrivacy(filename);
  const s = await fs.lstat(filename);
  if (s.isSymbolicLink() || !s.isFile() || s.nlink !== 1 || s.size < 1 || s.size > MAX_FILE_BYTES) fail("BACKUP_INPUT_INVALID");
  const bytes = await fs.readFile(filename);
  const after = await fs.lstat(filename);
  if (s.size !== bytes.length || after.size !== s.size || after.mtimeMs !== s.mtimeMs || after.ino !== s.ino) fail("BACKUP_INPUT_CHANGED");
  return bytes;
}
