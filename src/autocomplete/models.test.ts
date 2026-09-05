import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_INLINE_MODEL } from "./config";
import { inlineModelChoices, INLINE_MODEL_CANDIDATES } from "./models";

test("leads with the recommended default and keeps alternatives after it", () => {
  assert.equal(INLINE_MODEL_CANDIDATES[0]?.id, DEFAULT_INLINE_MODEL);
  assert.equal(INLINE_MODEL_CANDIDATES[0]?.badge.includes("★ recommended"), true);
  assert.ok(INLINE_MODEL_CANDIDATES.length >= 3);
});

test("every candidate carries a badge and a rationale", () => {
  for (const candidate of INLINE_MODEL_CANDIDATES) {
    assert.ok(candidate.badge.length > 0);
    assert.ok(candidate.detail.length > 0);
  }
});

test("candidate ids are unique", () => {
  assert.equal(new Set(INLINE_MODEL_CANDIDATES.map((candidate) => candidate.id)).size, INLINE_MODEL_CANDIDATES.length);
});

test("measured-problem models are marked with a warning badge", () => {
  for (const id of ["kimi-k2.6", "deepseek-v4-flash:0731", "deepseek-v4-pro:0813", "glm-5.3-flash", "glm-5.3"]) {
    const candidate = INLINE_MODEL_CANDIDATES.find((item) => item.id === id);
    assert.ok(candidate, `${id} should be listed`);
    assert.equal(candidate.badge.startsWith("⚠"), true, `${id} should carry a warning`);
  }
});

test("pins an unlisted current value above the vetted list", () => {
  const choices = inlineModelChoices("some-custom-model");
  assert.equal(choices[0]?.id, "some-custom-model");
  assert.equal(choices[0]?.description, "current value");
  assert.equal(choices[1]?.id, DEFAULT_INLINE_MODEL);
});

test("marks the current value with a check without pinning duplicates", () => {
  const choices = inlineModelChoices(DEFAULT_INLINE_MODEL);
  assert.equal(choices[0]?.label, `$(check) ${DEFAULT_INLINE_MODEL}`);
  assert.equal(choices.filter((choice) => choice.id === DEFAULT_INLINE_MODEL).length, 1);
});
