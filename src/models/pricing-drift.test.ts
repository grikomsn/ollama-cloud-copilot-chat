import assert from "node:assert/strict";
import test from "node:test";
import { comparePricingRows, parsePricingRows, resolvePricingRow } from "./pricing-drift";

const TABLE = `
<table>
  <tr><td><a href="/library/glm-5.2">glm-5.2</a></td><td>$1.40</td><td>$0.26</td><td>$4.40</td></tr>
  <tr><td><a href="/library/gpt-oss">gpt-oss:120b</a></td><td>$0.15</td><td>$0.014</td><td>$0.60</td></tr>
  <tr><td><a href="/library/nemotron-3-nano">nemotron-3-nano:30b</a></td><td>$0.06</td><td>-</td><td>$0.24</td></tr>
</table>`;

test("parses pricing rows and normalizes the dash cache column", () => {
  const rows = parsePricingRows(TABLE);
  assert.deepEqual(rows.get("glm-5.2"), { input: 1.4, cacheRead: 0.26, output: 4.4 });
  assert.deepEqual(rows.get("gpt-oss:120b"), { input: 0.15, cacheRead: 0.014, output: 0.6 });
  // A "-" in the cached-input column means no cache discount: cacheRead = input.
  assert.deepEqual(rows.get("nemotron-3-nano:30b"), { input: 0.06, cacheRead: 0.06, output: 0.24 });
});

test("throws when the table layout appears swapped", () => {
  const swapped = `<tr><td><a href="/library/glm-5.2">glm-5.2</a></td><td>$0.10</td><td>$0.26</td><td>$4.40</td></tr>`;
  assert.throws(() => parsePricingRows(swapped), /column order may have changed/);
});

test("throws when no pricing rows are found", () => {
  assert.throws(() => parsePricingRows("<html>nothing</html>"), /no pricing rows found/);
});

test("resolves exact rows then falls back to the :tag family", () => {
  const rows = parsePricingRows(TABLE);
  assert.deepEqual(resolvePricingRow("glm-5.2", rows), { name: "glm-5.2", price: rows.get("glm-5.2") });
  assert.deepEqual(resolvePricingRow("glm-5.2:future", rows), { name: "glm-5.2", price: rows.get("glm-5.2") });
  assert.equal(resolvePricingRow("unknown-model", rows), undefined);
});

test("compares bundled rows and reports drift per field", () => {
  const rows = parsePricingRows(TABLE);
  const comparison = comparePricingRows({
    "glm-5.2": { input: 1.4, cacheRead: 0.26, output: 4.4 },
    "gpt-oss:120b": { input: 0.15, cacheRead: 0.014, output: 0.7 },
    "deepseek-v4-pro": { input: 0.66, cacheRead: 0.022, output: 1.98 },
  }, rows);
  assert.deepEqual(comparison.drifts, [{
    id: "gpt-oss:120b",
    diffs: ["output 0.7 -> 0.6"],
    mayBePeakOffPeak: false,
  }]);
  assert.equal(comparison.unmatchedBundledIds.length, 1);
  assert.deepEqual(comparison.unmatchedLiveRows, ["nemotron-3-nano:30b"]);
});

test("flags DeepSeek drift as possible peak vs off-peak labeling", () => {
  const rows = parsePricingRows(TABLE.replaceAll("glm-5.2", "deepseek-v4-pro"));
  const { drifts } = comparePricingRows({
    "deepseek-v4-pro": { input: 0.66, cacheRead: 0.022, output: 1.98 },
  }, rows);
  assert.deepEqual(drifts, [{
    id: "deepseek-v4-pro",
    diffs: ["input 0.66 -> 1.4", "cacheRead 0.022 -> 0.26", "output 1.98 -> 4.4"],
    mayBePeakOffPeak: true,
  }]);
});
