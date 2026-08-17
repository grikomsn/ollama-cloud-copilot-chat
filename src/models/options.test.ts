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
  ["deepseek-v4-flash:0731", ["off", "high", "max"]],
  ["deepseek-v4-flash:preview", ["off", "high", "max"]],
  ["deepseek-v4-pro:preview", ["off", "high", "max"]],
  ["deepseek-v4-pro:0813", ["off", "high", "max"]],
  ["gemma4:31b", ["off", "on"]],
  ["glm-5.1", ["off", "on"]],
  ["glm-5.2", ["off", "high", "max"]],
  ["gpt-oss:20b", ["low", "medium", "high"]],
  ["gpt-oss:120b", ["low", "medium", "high"]],
  ["kimi-k2.6", ["off", "on"]],
  ["kimi-k2.7-code", ["off", "on"]],
  ["kimi-k3", ["off", "low", "high", "max"]],
  ["minimax-m3", ["default", "low", "medium", "high", "max"]],
  ["nemotron-3-nano:30b", ["off", "on"]],
  ["nemotron-3-super", ["off", "on"]],
  ["nemotron-3-ultra", ["off", "on"]],
  ["qwen3.5:397b", ["off", "on"]],
]);

test("every fallback model has its exact verified thinking profile", () => {
  for (const candidate of fallbackModels()) {
    const schema = buildThinkingSchema(candidate);
    const values = schema?.properties.reasoningEffort.enum;
    assert.deepEqual(values, EXPECTED_PROFILES.get(candidate.id), candidate.id);
    if (schema) assert.equal(Array.isArray(schema.properties.reasoningEffort.enumDescriptions), true, candidate.id);
  }
});

test("GPT-OSS supports only low, medium, and high", () => {
  const candidate = model("gpt-oss:20b", "gpt-oss");
  assert.equal(buildThinkingSchema(candidate)?.type, "object");
  assert.equal(resolveThinkValue(candidate, { reasoningEffort: "low" }), "low");
  assert.equal(resolveThinkValue(candidate, { reasoningEffort: "high" }), "high");
  assert.equal(resolveThinkValue(candidate, undefined), "high");
  assert.equal(resolveThinkValue(candidate, { reasoningEffort: "max" }), "high");
});

test("DeepSeek V4 Pro variants support off, high, and max", () => {
  for (const id of ["deepseek-v4-pro:preview", "deepseek-v4-pro:0813"]) {
    const candidate = model(id, "deepseek");
    assert.equal(resolveThinkValue(candidate, { reasoningEffort: "off" }), false, id);
    assert.equal(resolveThinkValue(candidate, { reasoningEffort: "high" }), "high", id);
    assert.equal(resolveThinkValue(candidate, { reasoningEffort: "max" }), "max", id);
    assert.equal(resolveThinkValue(candidate, { reasoningEffort: "low" }), "high", id);
  }
});

test("GLM 5.2 defaults to high while GLM 5.1 remains boolean", () => {
  const glm52 = model("glm-5.2", "glm");
  assert.equal(resolveThinkValue(glm52, undefined), "high");
  assert.equal(resolveThinkValue(glm52, { reasoningEffort: "off" }), false);
  assert.equal(resolveThinkValue(model("glm-5.1", "glm"), undefined), true);
});

test("Kimi K3 supports off plus low, high, and max", () => {
  const candidate = model("kimi-k3", "kimi");
  assert.equal(resolveThinkValue(candidate, undefined), "high");
  assert.equal(resolveThinkValue(candidate, { reasoningEffort: "off" }), false);
  assert.equal(resolveThinkValue(candidate, { reasoningEffort: "low" }), "low");
  assert.equal(resolveThinkValue(candidate, { reasoningEffort: "high" }), "high");
});

test("boolean models map Off and On to native booleans", () => {
  const candidate = model("qwen3.5:397b", "qwen");
  assert.equal(resolveThinkValue(candidate, { reasoningEffort: "off" }), false);
  assert.equal(resolveThinkValue(candidate, { reasoningEffort: "on" }), true);
  assert.equal(resolveThinkValue(candidate, { reasoningEffort: "max" }), true);
  assert.equal(resolveThinkValue(candidate, { thinkingEffort: "disabled" }), false);
  assert.equal(resolveThinkValue(candidate, { thinkingEffort: "enabled" }), true);
});

test("MiniMax M3 defaults to high and preserves an explicit native Default choice", () => {
  const candidate = model("minimax-m3", "minimax");
  assert.equal(resolveThinkValue(candidate, undefined), "high");
  assert.equal(resolveThinkValue(candidate, { reasoningEffort: "default" }), undefined);
  assert.equal(resolveThinkValue(candidate, { reasoningEffort: "low" }), "low");
  assert.equal(resolveThinkValue(candidate, { reasoningEffort: "medium" }), "medium");
  assert.equal(resolveThinkValue(candidate, { reasoningEffort: "high" }), "high");
  assert.equal(resolveThinkValue(candidate, { reasoningEffort: "max" }), "max");
  assert.equal(resolveThinkValue(candidate, { reasoningEffort: "off" }), "high");
});

test("model-managed, unknown, and non-thinking models expose no control", () => {
  assert.equal(resolveThinkValue(model("minimax-m2.7", "minimax"), {}), undefined);
  assert.equal(buildThinkingSchema(model("future-thinking", "future")), undefined);
  assert.equal(buildThinkingSchema(model("mistral-large-3:675b", "mistral", false)), undefined);
});
