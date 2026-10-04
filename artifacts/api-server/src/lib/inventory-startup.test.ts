import assert from "node:assert/strict";
import { test } from "node:test";
import { createInventoryStartup } from "./inventory-startup";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("slow database initialization does not block startup or mark inventory ready", async () => {
  const startup = createInventoryStartup();
  let release!: () => void;
  let readyCalls = 0;
  startup.start({
    initialize: () => new Promise<void>((resolve) => { release = resolve; }),
    onReady: () => { readyCalls++; },
    onError: () => assert.fail("unexpected initialization error"),
  });
  assert.equal(startup.isReady(), false);
  assert.equal(readyCalls, 0);
  release();
  await settle();
  assert.equal(startup.isReady(), true);
  assert.equal(readyCalls, 1);
});

test("a database failure remains explicit and retries without concurrent initialization", async () => {
  const startup = createInventoryStartup();
  const retries: Array<() => void> = [];
  const errors: unknown[] = [];
  let attempts = 0;
  let readyCalls = 0;
  const options = {
    initialize: async () => {
      attempts++;
      if (attempts === 1) throw new Error("database connection timed out");
    },
    onReady: () => { readyCalls++; },
    onError: (error: unknown) => { errors.push(error); },
    scheduleRetry: (retry: () => void) => { retries.push(retry); },
  };
  startup.start(options);
  startup.start(options);
  await settle();
  assert.equal(attempts, 1);
  assert.equal(startup.isReady(), false);
  assert.equal(errors.length, 1);
  assert.equal(retries.length, 1);
  assert.equal(readyCalls, 0);
  retries[0]();
  await settle();
  assert.equal(attempts, 2);
  assert.equal(startup.isReady(), true);
  assert.equal(readyCalls, 1);
  startup.start(options);
  assert.equal(attempts, 2);
});

test("synchronous initialization errors use the same retry path", async () => {
  const startup = createInventoryStartup();
  let errors = 0;
  let retries = 0;
  startup.start({
    initialize: () => { throw new Error("initialization failed"); },
    onReady: () => assert.fail("must not start supplier schedulers"),
    onError: () => { errors++; },
    scheduleRetry: () => { retries++; },
  });
  await settle();
  assert.equal(startup.isReady(), false);
  assert.equal(errors, 1);
  assert.equal(retries, 1);
});