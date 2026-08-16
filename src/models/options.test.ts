import assert from "node:assert/strict";
import test from "node:test";
import { fallbackModels, type CloudModel } from "./catalog";
import { buildThinkingSchema, resolveThinkValue } from "./options";

function model(id: string, family: string, thinking = true): CloudModel {
  return {
    id,
    name: id,
    family,
    version: "1",
    contextLength: 1000,
    maxOutputTokens: 1000,
    capabilities: { imageInput: false, toolCalling: true, thinking },
  };
}

const EXPECTED_PROFILES = new Map<string, readonly string[]>([
  ["deepseek-v4-flash:0731", ["disabled", "high", "max"]],
  ["deepseek-v4-flash:preview", ["disabled", "high", "max"]],
  ["deepseek-v4-pro:preview", ["disabled", "high", "max"]],
  ["deepseek-v4-pro:0813", ["disabled", "high", "max"]],
  ["gemma4:31b", ["disabled", "enabled"]],
  ["glm-5.1", ["disabled", "enabled"]],
  ["glm-5.2", ["disabled", "high", "max"]],
  ["gpt-oss:20b", ["low", "medium", "high"]],
  ["gpt-oss:120b", ["low", "medium", "high"]],
  ["kimi-k2.6", ["disabled", "enabled"]],
  ["kimi-k2.7-code", ["disabled", "enabled"]],
  ["kimi-k3", ["disabled", "low", "high", "max"]],
  ["minimax-m3", ["default", "low", "medium", "high", "max"]],
  ["nemotron-3-nano:30b", ["disabled", "enabled"]],
  ["nemotron-3-super", ["disabled", "enabled"]],
  ["nemotron-3-ultra", ["disabled", "enabled"]],
  ["qwen3.5:397b", ["disabled", "enabled"]],
]);

test("every fallback model has its exact verified thinking profile", () => {
  for (const candidate of fallbackModels()) {
    const values = buildThinkingSchema(candidate)?.properties.thinkingEffort.enum;
    assert.deepEqual(values, EXPECTED_PROFILES.get(candidate.id), candidate.id);
  }
});

test("GPT-OSS supports only low, medium, and high", () => {
  const candidate = model("gpt-oss:20b", "gpt-oss");
  assert.equal(buildThinkingSchema(candidate)?.type, "object");
  assert.equal(resolveThinkValue(candidate, { thinkingEffort: "low" }), "low");
  assert.equal(resolveThinkValue(candidate, { thinkingEffort: "high" }), "high");
  assert.equal(resolveThinkValue(candidate, { thinkingEffort: "max" }), "medium");
});

test("DeepSeek V4 Pro variants support off, high, and max", () => {
  for (const id of ["deepseek-v4-pro:preview", "deepseek-v4-pro:0813"]) {
    const candidate = model(id, "deepseek");
    assert.equal(resolveThinkValue(candidate, { thinkingEffort: "disabled" }), false, id);
    assert.equal(resolveThinkValue(candidate, { thinkingEffort: "high" }), "high", id);
    assert.equal(resolveThinkValue(candidate, { thinkingEffort: "max" }), "max", id);
    assert.equal(resolveThinkValue(candidate, { thinkingEffort: "low" }), "high", id);
  }
});

test("GLM 5.2 defaults to max while GLM 5.1 remains boolean", () => {
  const glm52 = model("glm-5.2", "glm");
  assert.equal(resolveThinkValue(glm52, undefined), "max");
  assert.equal(resolveThinkValue(glm52, { thinkingEffort: "disabled" }), false);
  assert.equal(resolveThinkValue(model("glm-5.1", "glm"), undefined), true);
});

test("Kimi K3 supports off plus low, high, and max", () => {
  const candidate = model("kimi-k3", "kimi");
  assert.equal(resolveThinkValue(candidate, undefined), "max");
  assert.equal(resolveThinkValue(candidate, { thinkingEffort: "disabled" }), false);
  assert.equal(resolveThinkValue(candidate, { thinkingEffort: "low" }), "low");
  assert.equal(resolveThinkValue(candidate, { thinkingEffort: "high" }), "high");
});

test("boolean models map Off and On to native booleans", () => {
  const candidate = model("qwen3.5:397b", "qwen");
  assert.equal(resolveThinkValue(candidate, { thinkingEffort: "disabled" }), false);
  assert.equal(resolveThinkValue(candidate, { thinkingEffort: "enabled" }), true);
  assert.equal(resolveThinkValue(candidate, { thinkingEffort: "max" }), true);
});

test("MiniMax M3 preserves its model default and supports exact effort levels", () => {
  const candidate = model("minimax-m3", "minimax");
  assert.equal(resolveThinkValue(candidate, undefined), undefined);
  assert.equal(resolveThinkValue(candidate, { thinkingEffort: "default" }), undefined);
  assert.equal(resolveThinkValue(candidate, { thinkingEffort: "low" }), "low");
  assert.equal(resolveThinkValue(candidate, { thinkingEffort: "medium" }), "medium");
  assert.equal(resolveThinkValue(candidate, { thinkingEffort: "high" }), "high");
  assert.equal(resolveThinkValue(candidate, { thinkingEffort: "max" }), "max");
  assert.equal(resolveThinkValue(candidate, { thinkingEffort: "disabled" }), undefined);
});

test("model-managed, unknown, and non-thinking models expose no control", () => {
  assert.equal(resolveThinkValue(model("minimax-m2.7", "minimax"), {}), undefined);
  assert.equal(buildThinkingSchema(model("future-thinking", "future")), undefined);
  assert.equal(buildThinkingSchema(model("mistral-large-3:675b", "mistral", false)), undefined);
});
