import assert from "node:assert/strict";
import test from "node:test";
import { type CloudModel } from "./catalog";
import { buildThinkingSchema, resolveThinkValue } from "./model-options";

function model(family: string, thinking = true): CloudModel {
  return {
    id: family,
    name: family,
    family,
    version: "1",
    contextLength: 1000,
    maxOutputTokens: 1000,
    capabilities: { imageInput: false, toolCalling: true, thinking },
  };
}

test("GPT-OSS offers only its supported levels", () => {
  const schema = buildThinkingSchema(model("gpt-oss"));
  assert.deepEqual(schema?.properties.thinkingEffort.enum, ["low", "medium", "high"]);
  assert.equal(resolveThinkValue(model("gpt-oss"), { thinkingEffort: "high" }), "high");
  assert.equal(resolveThinkValue(model("gpt-oss"), { thinkingEffort: "disabled" }), "medium");
});

test("Qwen and DeepSeek expose only their documented boolean control", () => {
  const schema = buildThinkingSchema(model("qwen"));
  assert.deepEqual(schema?.properties.thinkingEffort.enum, ["disabled", "enabled"]);
  assert.equal(resolveThinkValue(model("qwen"), { thinkingEffort: "disabled" }), false);
  assert.equal(resolveThinkValue(model("qwen"), { thinkingEffort: "enabled" }), true);
  assert.equal(resolveThinkValue(model("deepseek"), undefined), true);
});

test("model-managed thinking families do not advertise controls inferred from a flag", () => {
  assert.equal(buildThinkingSchema(model("minimax")), undefined);
  assert.equal(resolveThinkValue(model("minimax"), { thinkingEffort: "low" }), undefined);
  assert.equal(buildThinkingSchema(model("kimi")), undefined);
  assert.equal(resolveThinkValue(model("kimi"), { thinkingEffort: "disabled" }), undefined);
});

test("non-thinking models expose no controls or request value", () => {
  assert.equal(buildThinkingSchema(model("mistral", false)), undefined);
  assert.equal(resolveThinkValue(model("mistral", false), {}), undefined);
});
