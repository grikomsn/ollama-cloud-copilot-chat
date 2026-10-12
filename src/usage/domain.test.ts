import assert from "node:assert/strict";
import test from "node:test";
import {
  formatUsageRows,
  formatUsageStatusBar,
  formatUsageTooltip,
  isBalanceResponse,
  mergeAccountUsage,
  mergeBalanceUsage,
  recordRequestUsage,
  toUsagePayload,
  type OllamaUsageSnapshot,
} from "./domain";

test("maps native Ollama counts to provider usage data", () => {
  assert.deepEqual(toUsagePayload(12, 7), {
    prompt_tokens: 12,
    completion_tokens: 7,
    total_tokens: 19,
  });
});

test("parses account session and weekly utilization", () => {
  const snapshot = mergeAccountUsage({}, {
    activity: {
      cost: "1.25000",
      period: {
        type: "last_4_weeks",
        starting_at: "2026-06-29T00:00:00Z",
        ending_at: "2026-07-25T00:00:00Z",
      },
    },
    limits: {
      session: {
        usage: 0,
        models: [{ name: "gpt-oss:20b", request_count: 6 }],
      },
      weekly: {
        usage: 0.361,
        models: [
          { name: "minimax-m3", request_count: 1318 },
          { name: "glm-5.2", request_count: 134 },
        ],
      },
    },
  }, 123);
  assert.equal(snapshot.session?.usedRatio, 0);
  assert.equal(snapshot.weekly?.usedRatio, 0.361);
  assert.equal(snapshot.activityCost, "1.25000");
  assert.equal(snapshot.updatedAt, 123);
  assert.equal(formatUsageStatusBar(snapshot), "$(pulse) Ollama 5h 0% · 7d 36.1%");
  assert.match(formatUsageRows(snapshot)[1].detail ?? "", /minimax-m3: 1,318 req/);
});

test("tracks exact local request tokens without replacing account windows", () => {
  const current = mergeAccountUsage({}, {
    limits: {
      session: { usage: 0.1, models: [] },
      weekly: { usage: 0.2, models: [] },
    },
  });
  const first = recordRequestUsage(current, "gpt-oss:20b", 10, 4, 100);
  const second = recordRequestUsage(first, "glm-5.2", 20, 6, 200);
  assert.equal(second.session?.usedRatio, 0.1);
  assert.deepEqual(second.tracked, {
    requests: 2,
    promptTokens: 30,
    completionTokens: 10,
    totalTokens: 40,
    estimatedRequests: 0,
  });
  assert.equal(second.lastRequest?.modelId, "glm-5.2");
});

test("labels locally estimated request usage", () => {
  const snapshot = recordRequestUsage(
    {},
    "minimax-m3",
    120,
    8,
    100,
    { promptEstimated: true },
  );
  assert.equal(snapshot.lastRequest?.promptEstimated, true);
  assert.equal(snapshot.lastRequest?.completionEstimated, undefined);
  assert.equal(snapshot.tracked?.estimatedRequests, 1);
  assert.match(formatUsageRows(snapshot)[0].detail ?? "", /1 included estimates/);
  assert.match(formatUsageRows(snapshot)[1].detail ?? "", /120 estimated input/);
});

test("preserves stale usage and reports malformed refresh data", () => {
  const current = mergeAccountUsage({}, {
    limits: {
      session: { usage: 0.25, models: [] },
      weekly: { usage: 0.5, models: [] },
    },
  });
  const next = mergeAccountUsage(current, { limits: {} }, 456);
  assert.equal(next.session?.usedRatio, 0.25);
  assert.equal(next.weekly?.usedRatio, 0.5);
  assert.match(next.error ?? "", /did not include/);
  assert.equal(formatUsageStatusBar(next), "$(pulse) Ollama 5h 25% · 7d 50%");
});

test("reports current request activity without inventing or retaining stale quota windows", () => {
  const snapshot = mergeAccountUsage({ session: { usedRatio: 0.5, models: [] }, tracked: { requests: 1, promptTokens: 10, completionTokens: 5, totalTokens: 15 } }, {
    from: "2026-10-01T00:00:00Z", until: "2026-10-08T00:00:00Z", totals: { request_count: 12 }, buckets: [],
  }, 123);
  assert.equal(snapshot.session, undefined);
  assert.equal(snapshot.weekly, undefined);
  assert.equal(snapshot.error, undefined);
  assert.equal(snapshot.quotaUnavailable, true);
  assert.equal(snapshot.requestActivity?.requestCount, 12);
  assert.equal(snapshot.tracked?.totalTokens, 15);
  assert.match(formatUsageRows(snapshot).find((row) => row.label === "Quota limits unavailable")?.description ?? "", /without quota windows/);
});

test("validates balance responses strictly", () => {
  assert.equal(isBalanceResponse({
    included: {
      session: { remaining_percent: 92.5 },
      balance_usd: 55.5,
      allowance_usd: 60,
      period: { until: "2026-11-01T00:00:00Z" },
    },
    purchased: { balance_usd: 10 },
  }), true);
  assert.equal(isBalanceResponse({ included: { monthly: { remaining_percent: 50 } } }), true);
  assert.equal(isBalanceResponse({ purchased: { balance_usd: 5 } }), true);
  assert.equal(isBalanceResponse({ included: { session: { remaining_percent: "high" } } }), false);
  assert.equal(isBalanceResponse({ included: { balance_usd: 5 } }), false);
  assert.equal(isBalanceResponse({ included: { period: { until: 5 } } }), false);
  assert.equal(isBalanceResponse({ included: {} }), false);
  assert.equal(isBalanceResponse({ included: "nope" }), false);
  assert.equal(isBalanceResponse("nope"), false);
});

test("merges balance enrichment without clobbering account windows", () => {
  const current = mergeAccountUsage({}, {
    limits: {
      session: { usage: 0.1, models: [{ name: "gpt-oss:20b", request_count: 3 }] },
      weekly: { usage: 0.2, models: [] },
    },
  }, 100);
  const merged = mergeBalanceUsage(current, {
    included: {
      session: { remaining_percent: 50 },
      monthly: { remaining_percent: 75 },
      balance_usd: 15,
      allowance_usd: 60,
      period: { until: "2026-11-01T00:00:00Z" },
    },
    purchased: { balance_usd: 12.5 },
  }, 200);
  assert.equal(merged.session?.models.length, 1);
  assert.equal(merged.weekly?.usedRatio, 0.2);
  assert.equal(merged.monthly?.usedRatio, 0.25);
  assert.deepEqual(merged.plan, {
    usedRatio: 0.75,
    balanceUsd: 15,
    allowanceUsd: 60,
    renewsAt: "2026-11-01T00:00:00Z",
  });
  assert.equal(merged.purchasedUsd, 12.5);
  assert.equal(merged.updatedAt, 200);
  const rows = formatUsageRows(merged);
  assert.match(rows.find((row) => row.label === "Included plan balance")?.description ?? "", /\$15\.00 of \$60\.00/);
  assert.match(rows.find((row) => row.label === "Purchased credits")?.description ?? "", /\$12\.50/);
  assert.match(formatUsageTooltip(merged), /renews: 2026-11-01/);
});

test("fills quota windows from balance when account usage has none", () => {
  const current = mergeAccountUsage({}, {
    from: "2026-10-01T00:00:00Z", until: "2026-10-31T00:00:00Z", totals: { request_count: 5 },
  }, 100);
  assert.equal(current.quotaUnavailable, true);
  const merged = mergeBalanceUsage(current, {
    included: {
      session: { remaining_percent: 100 },
      weekly: { remaining_percent: 40 },
    },
  }, 200);
  assert.equal(merged.session?.usedRatio, 0);
  assert.equal(merged.weekly?.usedRatio, 0.6);
  assert.equal(merged.quotaUnavailable, true);
  assert.equal(formatUsageStatusBar(merged), "$(pulse) Ollama 5h 0% · 7d 60%");
});

test("ignores invalid balance payloads and leaves the snapshot untouched", () => {
  const current: OllamaUsageSnapshot = {
    session: { usedRatio: 0.5, models: [] },
    error: "keep me",
    updatedAt: 1,
  };
  assert.equal(mergeBalanceUsage(current, "junk", 2), current);
  assert.equal(mergeBalanceUsage(current, { included: { session: { remaining_percent: "x" } } }, 2), current);
  assert.equal(mergeBalanceUsage(current, { included: { session: { remaining_percent: 10 } } }, 2).error, "keep me");
});
