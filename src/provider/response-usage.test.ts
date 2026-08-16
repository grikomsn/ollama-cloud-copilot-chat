import assert from "node:assert/strict";
import test from "node:test";
import {
  createResponseUsageState,
  observeResponseUsage,
  resolveResponseUsage,
} from "./response-usage";

test("replaces native placeholder zeros when a completed response used tokens", () => {
  const state = createResponseUsageState();
  observeResponseUsage({ promptTokens: 0, completionTokens: 0, text: "answer", done: true }, state);
  assert.deepEqual(resolveResponseUsage(state, 100, 4), {
    promptTokens: 100,
    completionTokens: 2,
    promptEstimated: true,
    completionEstimated: true,
  });
});

test("preserves exact native zero when no usage was possible", () => {
  const state = createResponseUsageState();
  observeResponseUsage({ promptTokens: 0, completionTokens: 0, done: true }, state);
  assert.deepEqual(resolveResponseUsage(state, 0, 4), {
    promptTokens: 0,
    completionTokens: 0,
    promptEstimated: false,
    completionEstimated: false,
  });
});

test("combines native counts split across stream events", () => {
  const state = createResponseUsageState();
  observeResponseUsage({ promptTokens: 120 }, state);
  observeResponseUsage({ completionTokens: 9, done: true }, state);
  assert.deepEqual(resolveResponseUsage(state, 80, 4), {
    promptTokens: 120,
    completionTokens: 9,
    promptEstimated: false,
    completionEstimated: false,
  });
});

test("uses the latest native counts when repeated", () => {
  const state = createResponseUsageState();
  observeResponseUsage({ promptTokens: 10, completionTokens: 2 }, state);
  observeResponseUsage({ promptTokens: 15, completionTokens: 3, done: true }, state);
  assert.equal(resolveResponseUsage(state, 80, 4).promptTokens, 15);
  assert.equal(resolveResponseUsage(state, 80, 4).completionTokens, 3);
});

test("estimates only the missing side of partial usage", () => {
  const promptOnly = createResponseUsageState();
  observeResponseUsage({ promptTokens: 120, text: "12345678" }, promptOnly);
  assert.deepEqual(resolveResponseUsage(promptOnly, 80, 4), {
    promptTokens: 120,
    completionTokens: 2,
    promptEstimated: false,
    completionEstimated: true,
  });

  const completionOnly = createResponseUsageState();
  observeResponseUsage({ completionTokens: 9 }, completionOnly);
  assert.deepEqual(resolveResponseUsage(completionOnly, 80, 4), {
    promptTokens: 80,
    completionTokens: 9,
    promptEstimated: true,
    completionEstimated: false,
  });
});

test("fallback counts text, thinking, and serialized tool calls", () => {
  const state = createResponseUsageState();
  observeResponseUsage({
    text: "answer",
    thinking: "reasoning",
    toolCalls: [{
      id: "call-1",
      function: { name: "lookup", arguments: { query: "value" } },
    }],
  }, state);
  const usage = resolveResponseUsage(state, 250, 4);
  assert.equal(usage.promptTokens, 250);
  assert.equal(usage.promptEstimated, true);
  assert.equal(usage.completionEstimated, true);
  assert.ok(usage.completionTokens > Math.ceil("answerreasoning".length / 4));
});

test("empty generated output has a zero completion fallback", () => {
  const state = createResponseUsageState();
  assert.equal(resolveResponseUsage(state, 12, Number.NaN).completionTokens, 0);
});
