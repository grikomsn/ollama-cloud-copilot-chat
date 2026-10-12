import assert from "node:assert/strict";
import test from "node:test";
import { PROBE_TIERS, decideProbeStep, parseMaxOutputTokensError } from "./limit-probe";

test("parses the exact limit from an OpenAI-compat rejection message", () => {
  const message = "max_tokens (100000) exceeds model's maximum output tokens (65536) for model glm-5.3";
  assert.equal(parseMaxOutputTokensError(message), 65536);
});

test("returns undefined for unrelated rejections and empty messages", () => {
  assert.equal(parseMaxOutputTokensError(undefined), undefined);
  assert.equal(parseMaxOutputTokensError(""), undefined);
  assert.equal(parseMaxOutputTokensError("insufficient quota"), undefined);
  assert.equal(parseMaxOutputTokensError("maximum output tokens () broken"), undefined);
});

test("rejects non-positive parsed limits", () => {
  assert.equal(parseMaxOutputTokensError("maximum output tokens (0)"), undefined);
});

test("ascends to the next tier when a request is accepted", () => {
  assert.deepEqual(decideProbeStep(PROBE_TIERS[0], true), { action: "ascend", nextTier: PROBE_TIERS[1] });
  assert.deepEqual(decideProbeStep(PROBE_TIERS[2], true), { action: "ascend", nextTier: PROBE_TIERS[3] });
});

test("reports the top tier as unproven when even it is accepted", () => {
  const top = PROBE_TIERS[PROBE_TIERS.length - 1];
  assert.deepEqual(decideProbeStep(top, true), { action: "unproven", limit: top });
});

test("accepts the exact limit parsed from a rejection", () => {
  assert.deepEqual(
    decideProbeStep(131072, false, "max_tokens (131072) exceeds model's maximum output tokens (65536)"),
    { action: "accept", limit: 65536 },
  );
});

test("keeps the existing value for indeterminate rejections", () => {
  assert.deepEqual(decideProbeStep(65536, false, "insufficient quota"), { action: "keep-existing" });
  assert.deepEqual(decideProbeStep(65536, false, undefined), { action: "keep-existing" });
  assert.deepEqual(decideProbeStep(65536, false, "maximum output tokens (not-a-number)"), { action: "keep-existing" });
});
