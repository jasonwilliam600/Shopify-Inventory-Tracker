import assert from "node:assert/strict"
import { test } from "node:test"
import { formatSupplierSuccessfulUpdate } from "./supplier-timestamps"

test("successful timestamp displays the recorded Eastern instant, not the current time", () => {
  assert.equal(formatSupplierSuccessfulUpdate("2026-10-17T01:22:40.965Z"), "10/16/2026 9:22 PM EDT")
  assert.equal(formatSupplierSuccessfulUpdate("2026-01-17T01:22:40.965Z"), "01/16/2026 8:22 PM EST")
})

test("spring daylight-saving transition automatically changes EST to EDT", () => {
  assert.equal(formatSupplierSuccessfulUpdate("2026-03-08T06:59:00Z"), "03/08/2026 1:59 AM EST")
  assert.equal(formatSupplierSuccessfulUpdate("2026-03-08T07:00:00Z"), "03/08/2026 3:00 AM EDT")
})

test("fall daylight-saving transition distinguishes the two 1 AM hours", () => {
  assert.equal(formatSupplierSuccessfulUpdate("2026-11-01T05:30:00Z"), "11/01/2026 1:30 AM EDT")
  assert.equal(formatSupplierSuccessfulUpdate("2026-11-01T06:30:00Z"), "11/01/2026 1:30 AM EST")
})

test("missing, invalid, or unzoned times are Unknown, never a fabricated success", () => {
  for (const value of [null, undefined, "", "not a timestamp", "2026-10-16T21:22:00", "2026-15-99T00:00:00Z", new Date("invalid")]) {
    assert.equal(formatSupplierSuccessfulUpdate(value), "Unknown")
  }
})

test("explicit offsets and Date inputs resolve to the same persisted instant", () => {
  assert.equal(formatSupplierSuccessfulUpdate("2026-10-16T21:22:00-04:00"), "10/16/2026 9:22 PM EDT")
  const input = new Date("2026-10-17T01:22:00Z")
  const original = input.getTime()
  assert.equal(formatSupplierSuccessfulUpdate(input), "10/16/2026 9:22 PM EDT")
  assert.equal(input.getTime(), original)
})
