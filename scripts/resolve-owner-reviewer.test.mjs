import test from "node:test";
import assert from "node:assert/strict";
import { verifiedOwnerSubject, resolveDevelopmentOwner } from "./resolve-owner-reviewer.mjs";

const email = "synthetic-owner@example.invalid";
const account = () => ({ id: "user_SyntheticOwner", banned: false, locked: false,
  primaryEmailAddressId: "id_synthetic",
  emailAddresses: [{ id: "id_synthetic", emailAddress: email, verification: { status: "verified" } }] });
const page = user => ({ data: [user], totalCount: 1 });

test("resolves only the explicitly identified verified primary owner account", () => {
  assert.equal(verifiedOwnerSubject(` ${email.toUpperCase()} `, page(account())), "user_SyntheticOwner");
});
test("does not choose the first user or automatically create an owner", () => {
  assert.throws(() => verifiedOwnerSubject(email, { data: [], totalCount: 0 }), /OWNER_SIGN_IN_REQUIRED/);
  assert.throws(() => verifiedOwnerSubject(email, { data: [account(), account()], totalCount: 2 }), /AMBIGUOUS/);
});
test("unverified, nonprimary and wrong-email accounts cannot receive privileges", () => {
  const u = account(); u.emailAddresses[0].verification.status = "unverified";
  assert.throws(() => verifiedOwnerSubject(email, page(u)), /NOT_VERIFIED/);
  assert.throws(() => verifiedOwnerSubject("someone-else@example.invalid", page(account())), /MISMATCH/);
  u.emailAddresses.push({ id: "other", emailAddress: "primary@example.invalid", verification: { status: "verified" } });
  u.primaryEmailAddressId = "other";
  assert.throws(() => verifiedOwnerSubject(email, page(u)), /MISMATCH/);
});
test("banned or locked accounts and invalid subjects fail closed", () => {
  for (const changes of [{ banned: true }, { locked: true }, { locked: undefined }]) {
    assert.throws(() => verifiedOwnerSubject(email, page({ ...account(), ...changes })), /NOT_ACTIVE/);
  }
  assert.throws(() => verifiedOwnerSubject(email, page({ ...account(), id: "bad" })), /SUBJECT_INVALID/);
});
test("production or missing credentials are rejected BEFORE any identity-service request", async () => {
  for (const key of ["pk_live_synthetic", undefined]) {
    await assert.rejects(resolveDevelopmentOwner({ publishableKey: key, email,
      lookup: () => assert.fail("Identity service must not be called") }), /DEVELOPMENT_AUTH_ONLY/);
  }
});
test("missing owner configuration is rejected before any identity-service request", async () => {
  await assert.rejects(resolveDevelopmentOwner({ publishableKey: "pk_test_synthetic", email: "",
    lookup: () => assert.fail("Identity service must not be called") }), /OWNER_EMAIL_REQUIRED/);
});
test("development lookup uses only the specified email and returns no permission grant", async () => {
  let observed;
  const result = await resolveDevelopmentOwner({ publishableKey: "pk_test_synthetic", email,
    lookup: async args => { observed = args; return page(account()); } });
  assert.deepEqual(observed, { emailAddress: [email], limit: 2 });
  assert.equal(result, "user_SyntheticOwner");
});
