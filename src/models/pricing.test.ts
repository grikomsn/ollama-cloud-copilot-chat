import assert from "node:assert/strict";
import test from "node:test";
import { costCategory, modelPricingFields, ollamaModelCost } from "./pricing";

test("maps published Ollama Cloud rates for hosted model ids", () => {
  assert.deepEqual(ollamaModelCost("glm-5.3"), { input: 1.4, cacheRead: 0.26, output: 4.4 });
  assert.deepEqual(ollamaModelCost("glm-5.3-flash"), { input: 0.15, cacheRead: 0.03, output: 0.5 });
  assert.deepEqual(ollamaModelCost("glm-5.2"), { input: 1.4, cacheRead: 0.26, output: 4.4 });
  assert.deepEqual(ollamaModelCost("glm-5.1"), { input: 1, cacheRead: 0.2, output: 3.2 });
  assert.deepEqual(ollamaModelCost("deepseek-v4-flash:0731"), { input: 0.22, cacheRead: 0.007, output: 0.66 });
  assert.deepEqual(ollamaModelCost("deepseek-v4-pro:0813"), { input: 0.66, cacheRead: 0.022, output: 1.98 });
  assert.deepEqual(ollamaModelCost("gemma4:31b"), { input: 0.14, cacheRead: 0.05, output: 0.4 });
  assert.deepEqual(ollamaModelCost("kimi-k3"), { input: 3, cacheRead: 0.3, output: 15 });
  assert.deepEqual(ollamaModelCost("kimi-k2.7-code"), { input: 0.95, cacheRead: 0.19, output: 4 });
  assert.deepEqual(ollamaModelCost("kimi-k2.6"), { input: 0.95, cacheRead: 0.16, output: 4 });
  assert.deepEqual(ollamaModelCost("minimax-m3"), { input: 0.6, cacheRead: 0.12, output: 2.4 });
  assert.deepEqual(ollamaModelCost("minimax-m2.7"), { input: 0.3, cacheRead: 0.06, output: 1.2 });
  assert.deepEqual(ollamaModelCost("nemotron-3-super"), { input: 0.015, cacheRead: 0.015, output: 0.6 });
  assert.deepEqual(ollamaModelCost("nemotron-3-ultra"), { input: 0.1, cacheRead: 0.1, output: 3 });
  assert.deepEqual(ollamaModelCost("gpt-oss:120b"), { input: 0.15, cacheRead: 0.014, output: 0.6 });
  assert.deepEqual(ollamaModelCost("gpt-oss:20b"), { input: 0.07, cacheRead: 0.035, output: 0.3 });
});

test("omits cache pricing where Ollama publishes none", () => {
  assert.deepEqual(ollamaModelCost("mistral-large-3:675b"), { input: 0.5, output: 1.5 });
  assert.deepEqual(ollamaModelCost("nemotron-3-nano:30b"), { input: 0.06, output: 0.24 });
  assert.deepEqual(ollamaModelCost("qwen3.5:397b"), { input: 0.6, output: 3.6 });
});

test("resolves family rates for unlisted tags and never guesses tag rates", () => {
  assert.deepEqual(ollamaModelCost("gemma4:12b"), { input: 0.14, cacheRead: 0.05, output: 0.4 });
  assert.deepEqual(ollamaModelCost("deepseek-v4-flash:future"), { input: 0.22, cacheRead: 0.007, output: 0.66 });
  assert.equal(ollamaModelCost("gpt-oss:70b"), undefined);
  assert.equal(ollamaModelCost("qwen3.5:122b"), undefined);
  assert.equal(ollamaModelCost("kimi-k4"), undefined);
  assert.equal(ollamaModelCost("future-model"), undefined);
});

test("formats picker pricing fields in integer cents", () => {
  assert.deepEqual(modelPricingFields({ input: 0.22, cacheRead: 0.007, output: 0.66 }), {
    pricing: "In: $0.22 · Cached: $0.007 · Out: $0.66 /1M tokens",
    inputCost: 22,
    outputCost: 66,
    cacheCost: 1,
    priceCategory: "low",
  });
  assert.deepEqual(modelPricingFields({ input: 3, cacheRead: 0.3, output: 15 }), {
    pricing: "In: $3 · Cached: $0.3 · Out: $15 /1M tokens",
    inputCost: 300,
    outputCost: 1500,
    cacheCost: 30,
    priceCategory: "medium",
  });
  assert.deepEqual(modelPricingFields({ input: 0.5, output: 1.5 }), {
    pricing: "In: $0.5 · Out: $1.5 /1M tokens",
    inputCost: 50,
    outputCost: 150,
    priceCategory: "medium",
  });
  assert.deepEqual(modelPricingFields({ input: 0, output: 0 }), {
    pricing: "Free",
    inputCost: 0,
    outputCost: 0,
    priceCategory: "low",
  });
  assert.equal(modelPricingFields(undefined), undefined);
});

test("classifies price categories from weighted input and output", () => {
  assert.equal(costCategory({ input: 0.06, output: 0.24 }), "low");
  assert.equal(costCategory({ input: 1.4, output: 4.4 }), "medium");
  assert.equal(costCategory({ input: 3, output: 15 }), "medium");
  assert.equal(costCategory({ input: 10, output: 20 }), "high");
  assert.equal(costCategory({ input: 15, output: 60 }), "very_high");
});
