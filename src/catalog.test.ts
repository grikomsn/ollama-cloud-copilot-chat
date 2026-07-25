import assert from "node:assert/strict";
import test from "node:test";
import {
  CATALOG_CACHE_KEY,
  ModelCatalog,
  fallbackModels,
  findContextLength,
  humanizeModelId,
  modelFromShow,
  type CatalogCache,
} from "./catalog";

class MemoryCache implements CatalogCache {
  readonly values = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

test("fallback catalog includes current cloud models and rich capabilities", () => {
  const models = fallbackModels();
  assert.equal(models.length, 18);
  const gemma = models.find((model) => model.id === "gemma4:31b");
  assert.equal(gemma?.contextLength, 262144);
  assert.deepEqual(gemma?.capabilities, {
    imageInput: true,
    toolCalling: true,
    thinking: true,
  });
});

test("show metadata overrides context and capabilities", () => {
  const model = modelFromShow("future-model:9b", {
    capabilities: ["completion", "vision", "tools", "thinking"],
    details: {
      family: "future",
      parameter_size: "9B",
      quantization_level: "FP8",
    },
    model_info: {
      "future.context_length": 65536,
    },
  });
  assert.equal(model.contextLength, 65536);
  assert.equal(model.maxOutputTokens, 32768);
  assert.equal(model.parameterSize, "9B");
  assert.equal(model.quantization, "FP8");
  assert.equal(model.capabilities.imageInput, true);
  assert.equal(model.capabilities.thinking, true);
});

test("normalizes low-level architecture names into stable model families", () => {
  assert.equal(modelFromShow("gpt-oss:20b", {
    details: { family: "gptoss" },
  }).family, "gpt-oss");
  assert.equal(modelFromShow("minimax-m3", {
    details: { family: "minimax-m3" },
  }).family, "minimax");
});

test("finds architecture-specific context length", () => {
  assert.equal(findContextLength({ "general.name": "x", "qwen.context_length": 262144 }), 262144);
  assert.equal(findContextLength({ "x.context_length": -1 }), undefined);
});

test("refresh hydrates models and persists the cache", async () => {
  const cache = new MemoryCache();
  const requests: string[] = [];
  const catalog = new ModelCatalog(cache, async (input, init) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("/tags")) {
      return Response.json({ models: [{ name: "gpt-oss:20b" }, { model: "new-model" }] });
    }
    const body = JSON.parse(String(init?.body)) as { model: string };
    return Response.json({
      capabilities: body.model === "new-model"
        ? ["completion", "vision"]
        : ["completion", "tools", "thinking"],
      details: { family: body.model.split("-")[0] },
      model_info: { "model.context_length": body.model === "new-model" ? 64000 : 131072 },
    });
  });

  const models = await catalog.refresh("not-logged");
  assert.equal(models.length, 2);
  assert.equal(requests.length, 3);
  assert.equal(models.find((model) => model.id === "new-model")?.capabilities.imageInput, true);
  assert.equal(Array.isArray(cache.values.get(CATALOG_CACHE_KEY)), true);
});

test("falls back per model when show hydration fails", async () => {
  const catalog = new ModelCatalog(new MemoryCache(), async (input) => {
    if (String(input).endsWith("/tags")) return Response.json({ models: [{ name: "gpt-oss:120b" }] });
    return new Response("unavailable", { status: 503 });
  });
  const models = await catalog.refresh("not-logged");
  assert.equal(models[0].contextLength, 131072);
  assert.equal(models[0].capabilities.thinking, true);
});

test("formats model identifiers for the picker", () => {
  assert.equal(humanizeModelId("gpt-oss:120b"), "GPT OSS 120B");
  assert.equal(humanizeModelId("deepseek-v4-flash"), "DeepSeek V4 Flash");
});
