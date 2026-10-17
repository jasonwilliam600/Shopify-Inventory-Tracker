/**
 * Read-only development Clerk lookup. Does not create users, grant permissions,
 * update environment variables, access the application DB or contact Shopify.
 * The owner must first identify and sign in to their own verified account.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

function stop(code) { throw new Error(code); }

export function verifiedOwnerSubject(expectedEmail, page) {
  if (typeof expectedEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expectedEmail.trim())) {
    stop("OWNER_EMAIL_REQUIRED");
  }
  if (!Array.isArray(page?.data) || page.data.length === 0) stop("OWNER_SIGN_IN_REQUIRED");
  if (page.totalCount !== 1 || page.data.length !== 1) stop("OWNER_ACCOUNT_LOOKUP_AMBIGUOUS");
  const user = page.data[0];
  const primary = user.emailAddresses?.find(e => e.id === user.primaryEmailAddressId);
  if (primary?.emailAddress?.toLowerCase() !== expectedEmail.trim().toLowerCase()) stop("OWNER_PRIMARY_EMAIL_MISMATCH");
  if (primary?.verification?.status !== "verified") stop("OWNER_EMAIL_NOT_VERIFIED");
  if (user.banned !== false || user.locked !== false) stop("OWNER_ACCOUNT_NOT_ACTIVE");
  if (typeof user.id !== "string" || !/^user_[A-Za-z0-9]+$/.test(user.id)) stop("OWNER_SUBJECT_INVALID");
  return user.id;
}

export async function resolveDevelopmentOwner({ publishableKey, email, lookup }) {
  if (typeof publishableKey !== "string" || !publishableKey.startsWith("pk_test_")) stop("DEVELOPMENT_AUTH_ONLY");
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) stop("OWNER_EMAIL_REQUIRED");
  return verifiedOwnerSubject(email, await lookup({ emailAddress: [email.trim()], limit: 2 }));
}

const safeCodes = new Set([
  "OWNER_EMAIL_REQUIRED", "OWNER_SIGN_IN_REQUIRED", "OWNER_ACCOUNT_LOOKUP_AMBIGUOUS",
  "OWNER_PRIMARY_EMAIL_MISMATCH", "OWNER_EMAIL_NOT_VERIFIED", "OWNER_ACCOUNT_NOT_ACTIVE",
  "OWNER_SUBJECT_INVALID", "DEVELOPMENT_AUTH_ONLY",
]);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const subject = await resolveDevelopmentOwner({
      publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
      email: process.env.MAPPING_OWNER_EMAIL,
      lookup: async query => {
        const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
        const { clerkClient } = require("@clerk/express");
        return clerkClient.users.getUserList(query);
      },
    });
    console.log(JSON.stringify({ status: "VERIFIED_ACCOUNT_FOUND", subject, environment: "development",
      permissionGranted: false, nextAction: "Explicit owner allowlist configuration is still required." }));
  } catch (error) {
    const code = safeCodes.has(error?.message) ? error.message : "CLERK_ACCOUNT_LOOKUP_FAILED";
    console.error(JSON.stringify({ status: "BLOCKED", code, permissionGranted: false }));
    process.exitCode = 1;
  }
}
