import assert from "node:assert/strict";
import test from "node:test";
import { USAGE_REFRESH_MIN_INTERVAL_MS, shouldAutoRefreshUsage } from "./throttle";

test("refreshes when the credential has never been refreshed", () => {
  assert.equal(shouldAutoRefreshUsage(1_000, undefined), true);
});

test("refreshes when the last refresh timestamp is invalid", () => {
  assert.equal(shouldAutoRefreshUsage(1_000, Number.NaN), true);
  assert.equal(shouldAutoRefreshUsage(1_000, -1), true);
});

test("skips within the cooldown and refreshes once it elapses", () => {
  const last = 1_000_000;
  assert.equal(shouldAutoRefreshUsage(last + USAGE_REFRESH_MIN_INTERVAL_MS - 1, last), false);
  assert.equal(shouldAutoRefreshUsage(last + USAGE_REFRESH_MIN_INTERVAL_MS, last), true);
  assert.equal(shouldAutoRefreshUsage(last + USAGE_REFRESH_MIN_INTERVAL_MS + 1, last), true);
});

test("treats a future last-refresh timestamp as inside the cooldown", () => {
  assert.equal(shouldAutoRefreshUsage(1_000, 2_000), false);
});

test("honors a custom minimum interval", () => {
  const last = 500_000;
  assert.equal(shouldAutoRefreshUsage(last + 999, last, 1_000), false);
  assert.equal(shouldAutoRefreshUsage(last + 1_000, last, 1_000), true);
});
