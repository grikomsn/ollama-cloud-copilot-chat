import assert from "node:assert/strict";
import test from "node:test";
import { fallbackModels, type CloudModel } from "./catalog";
import { buildModelConfigurationSchema, buildThinkingSchema, contextSizeOptions, resolveContextCap, resolveContextSize, resolveThinkValue } from "./options";

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
  ["deepseek-v4-pro:0813", ["off", "high", "max"]],
  ["gemma4:31b", ["off", "on"]],
  ["glm-5.1", ["off", "on"]],
  ["glm-5.2", ["off", "high", "max"]],
  ["glm-5.3", ["low", "high", "max"]],
  ["glm-5.3-flash", ["low", "high", "max"]],
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

test("DeepSeek V4 Pro supports off, high, and max", () => {
  for (const id of ["deepseek-v4-pro:0813"]) {
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

test("GLM 5.3 models default to max and support their documented efforts", () => {
  for (const id of ["glm-5.3", "glm-5.3-flash"]) {
    const candidate = model(id, "glm");
    assert.equal(resolveThinkValue(candidate, undefined), "max", id);
    assert.equal(resolveThinkValue(candidate, { reasoningEffort: "low" }), "low", id);
    assert.equal(resolveThinkValue(candidate, { reasoningEffort: "high" }), "high", id);
    assert.equal(resolveThinkValue(candidate, { reasoningEffort: "off" }), "max", id);
  }
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

test("offers context tiers below the registered input limit", () => {
  assert.deepEqual(contextSizeOptions(180_224)?.map((option) => option.value), [0, 65_536, 131_072, 180_224]);
  assert.deepEqual(contextSizeOptions(180_224)?.map((option) => option.label), ["Auto", "64K", "128K", "Maximum"]);
  assert.equal(contextSizeOptions(65_536), undefined);
  assert.equal(contextSizeOptions(32_000), undefined);
});

test("combines thinking controls with the Context Window control", () => {
  const schema = buildModelConfigurationSchema(model("kimi-k3", "kimi"), contextSizeOptions(180_224));
  assert.deepEqual(schema?.properties.reasoningEffort.enum, ["off", "low", "high", "max"]);
  assert.deepEqual(schema?.properties.contextSize.enum, [0, 65_536, 131_072, 180_224]);
  assert.equal(schema?.properties.contextSize.default, 0);
  assert.equal(schema?.properties.contextSize.group, "navigation");

  const contextOnly = buildModelConfigurationSchema(model("mistral-large-3:675b", "mistral", false), contextSizeOptions(180_224));
  assert.equal("reasoningEffort" in (contextOnly?.properties ?? {}), false);
  assert.deepEqual(contextOnly?.properties.contextSize.enum, [0, 65_536, 131_072, 180_224]);
  assert.equal(buildModelConfigurationSchema(model("mistral-large-3:675b", "mistral", false), undefined), undefined);
});

test("resolves the effective context cap from the selected tier", () => {
  assert.equal(resolveContextCap(131_072, 180_224), 131_072);
  assert.equal(resolveContextCap(300_000, 180_224), undefined);
  assert.equal(resolveContextCap(0, 180_224), undefined);
  assert.equal(resolveContextCap(-5, 180_224), undefined);
  assert.equal(resolveContextCap(65_536, 65_536), undefined);
});

test("reads the context size from picker configuration", () => {
  assert.equal(resolveContextSize({ contextSize: 131_072 }), 131_072);
  assert.equal(resolveContextSize({ contextSize: 0 }), 0);
  assert.equal(resolveContextSize({ contextSize: "131072" }), 0);
  assert.equal(resolveContextSize(undefined), 0);
});
