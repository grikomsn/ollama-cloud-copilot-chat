import assert from "node:assert/strict";
import test from "node:test";
import { fallbackModels, type CloudModel } from "./catalog";
import { buildThinkingSchema, resolveThinkValue } from "./model-options";

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

test("GPT-OSS offers only its supported levels", () => {
  const gptOss = model("gpt-oss:20b", "gpt-oss");
  const schema = buildThinkingSchema(gptOss);
  assert.equal(schema?.type, "object");
  assert.deepEqual(schema?.properties.thinkingEffort.enum, ["low", "medium", "high"]);
  assert.equal(resolveThinkValue(gptOss, { thinkingEffort: "high" }), "high");
  assert.equal(resolveThinkValue(gptOss, { thinkingEffort: "disabled" }), "medium");
});

test("live-verified Ollama Cloud models expose a boolean control", () => {
  const qwen = model("qwen3.5:397b", "qwen");
  const schema = buildThinkingSchema(qwen);
  assert.deepEqual(schema?.properties.thinkingEffort.enum, ["disabled", "enabled"]);
  assert.equal(resolveThinkValue(qwen, { thinkingEffort: "disabled" }), false);
  assert.equal(resolveThinkValue(qwen, { thinkingEffort: "enabled" }), true);
  assert.equal(resolveThinkValue(model("deepseek-v4-pro", "deepseek"), undefined), true);
});

test("every fallback model has its verified thinking profile", () => {
  const expectedBoolean = new Set([
    "deepseek-v4-flash:0731",
    "deepseek-v4-flash:preview",
    "deepseek-v4-pro",
    "gemma4:31b",
    "glm-5.1",
    "glm-5.2",
    "kimi-k2.6",
    "kimi-k2.7-code",
    "nemotron-3-nano:30b",
    "nemotron-3-super",
    "nemotron-3-ultra",
    "qwen3.5:397b",
  ]);
  for (const candidate of fallbackModels()) {
    const values = buildThinkingSchema(candidate)?.properties.thinkingEffort.enum;
    if (expectedBoolean.has(candidate.id)) {
      assert.deepEqual(values, ["disabled", "enabled"], candidate.id);
    } else if (candidate.id.startsWith("gpt-oss:")) {
      assert.deepEqual(values, ["low", "medium", "high"], candidate.id);
    } else {
      assert.equal(values, undefined, candidate.id);
    }
  }
});

test("model-managed and unknown thinking models do not inherit family controls", () => {
  const minimax = model("minimax-m3", "minimax");
  assert.equal(buildThinkingSchema(minimax), undefined);
  assert.equal(resolveThinkValue(minimax, { thinkingEffort: "low" }), undefined);
  assert.equal(buildThinkingSchema(model("kimi-k3", "kimi")), undefined);
  assert.equal(buildThinkingSchema(model("kimi-future", "kimi")), undefined);
  assert.equal(buildThinkingSchema(model("deepseek-future", "deepseek")), undefined);
});

test("non-thinking models expose no controls or request value", () => {
  const mistral = model("mistral-large-3:675b", "mistral", false);
  assert.equal(buildThinkingSchema(mistral), undefined);
  assert.equal(resolveThinkValue(mistral, {}), undefined);
});
