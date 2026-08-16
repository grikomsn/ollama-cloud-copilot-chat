import assert from "node:assert/strict";
import test from "node:test";
import {
  formatUsageRows,
  formatUsageStatusBar,
  mergeAccountUsage,
  recordRequestUsage,
  toUsagePayload,
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
