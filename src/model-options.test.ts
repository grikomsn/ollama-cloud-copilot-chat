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

test("other thinking models support off and standardized levels", () => {
  const schema = buildThinkingSchema(model("qwen"));
  assert.deepEqual(schema?.properties.thinkingEffort.enum, ["disabled", "low", "medium", "high", "max"]);
  assert.equal(resolveThinkValue(model("qwen"), { thinkingEffort: "disabled" }), false);
  assert.equal(resolveThinkValue(model("qwen"), { thinkingEffort: "max" }), "max");
});

test("MiniMax omits off because the cloud backend keeps thinking enabled", () => {
  const schema = buildThinkingSchema(model("minimax"));
  assert.deepEqual(schema?.properties.thinkingEffort.enum, ["low", "medium", "high", "max"]);
  assert.equal(resolveThinkValue(model("minimax"), { thinkingEffort: "disabled" }), "high");
  assert.equal(resolveThinkValue(model("minimax"), { thinkingEffort: "low" }), "low");
});

test("non-thinking models expose no controls or request value", () => {
  assert.equal(buildThinkingSchema(model("mistral", false)), undefined);
  assert.equal(resolveThinkValue(model("mistral", false), {}), undefined);
});
