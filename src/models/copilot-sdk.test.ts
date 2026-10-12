import assert from "node:assert/strict";
import test from "node:test";
import { fallbackModels } from "./catalog";
import { buildModelConfigurationSchema, contextSizeOptions, resolveThinkValue } from "./options";

// VS Code 1.141: AgentHostByokLmHandler reads this exact schema key;
// CopilotAgent then filters it through common/reasoningEffort.ts.
const SDK_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);

test("Copilot SDK BYOK discovers model efforts with and without Context Window", () => {
  const cases = [
    ["gpt-oss:20b", ["low", "medium", "high"], ["low", "medium", "high"]],
    ["glm-5.3-flash", ["low", "high", "max"], ["low", "high", "max"]],
    ["gemma4:31b", ["off", "on"], []],
    ["minimax-m3", ["default", "low", "medium", "high", "max"], ["low", "medium", "high", "max"]],
  ] as const;
  for (const [id, expectedBridge, expectedSdk] of cases) {
    const model = fallbackModels().find((candidate) => candidate.id === id);
    assert.ok(model, id);
    for (const context of [undefined, contextSizeOptions(244_800)]) {
      const schema = buildModelConfigurationSchema(model, context);
      const effortSchema = schema?.properties.reasoningEffort;
      assert.ok(effortSchema, `${id}: BYOK requires reasoningEffort`);
      const bridged = (effortSchema.enum as unknown[]).filter((value): value is string => typeof value === "string");
      assert.deepEqual(bridged, expectedBridge, id);
      assert.ok(bridged.includes(String(effortSchema.default)), id);
      assert.deepEqual(bridged.filter((effort) => SDK_EFFORTS.has(effort)), expectedSdk, id);
    }
  }
  const plain = { ...fallbackModels()[0], capabilities: { imageInput: false, toolCalling: true, thinking: false } };
  assert.equal(buildModelConfigurationSchema(plain, contextSizeOptions(244_800))?.properties.reasoningEffort, undefined);
});

test("Copilot SDK effort selections resolve to native Ollama think values", () => {
  const model = fallbackModels().find((candidate) => candidate.id === "glm-5.3-flash");
  assert.ok(model);
  const schema = buildModelConfigurationSchema(model, contextSizeOptions(244_800));
  const bridged = (schema?.properties.reasoningEffort.enum as unknown[]).filter((value): value is string => typeof value === "string");
  for (const effort of bridged.filter((value) => SDK_EFFORTS.has(value))) {
    assert.equal(resolveThinkValue(model, { reasoningEffort: effort }), effort);
  }
  // Local chat retains native toggle/default choices that the SDK filters out.
  const toggle = fallbackModels().find((candidate) => candidate.id === "gemma4:31b");
  const nativeDefault = fallbackModels().find((candidate) => candidate.id === "minimax-m3");
  assert.ok(toggle);
  assert.ok(nativeDefault);
  assert.equal(resolveThinkValue(toggle, { reasoningEffort: "off" }), false);
  assert.equal(resolveThinkValue(toggle, { reasoningEffort: "on" }), true);
  assert.equal(resolveThinkValue(nativeDefault, { reasoningEffort: "default" }), undefined);
});
