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
import { MODELS_DEV_API_URL } from "./metadata";

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
  assert.equal(models.length, 23);
  const glm53 = models.find((model) => model.id === "glm-5.3");
  assert.equal(glm53?.contextLength, 1048576);
  assert.equal(glm53?.maxOutputTokens, 131072);
  assert.deepEqual(glm53?.capabilities, {
    imageInput: false,
    toolCalling: true,
    thinking: true,
  });
  const glm53Flash = models.find((model) => model.id === "glm-5.3-flash");
  assert.equal(glm53Flash?.contextLength, 1000000);
  assert.equal(glm53Flash?.maxOutputTokens, 131072);
  assert.deepEqual(glm53Flash?.capabilities, {
    imageInput: true,
    toolCalling: true,
    thinking: true,
  });
  const deepseek = models.find((model) => model.id === "deepseek-v4-flash:0731");
  assert.equal(deepseek?.contextLength, 1048576);
  assert.equal(deepseek?.maxOutputTokens, 384000);
  assert.deepEqual(deepseek?.capabilities, {
    imageInput: false,
    toolCalling: true,
    thinking: true,
  });
  assert.equal(models.some((model) => model.id === "kimi-k2.5"), true);
  assert.equal(models.some((model) => model.id === "minimax-m2.5"), true);
  assert.equal(models.some((model) => model.id === "deepseek-v4-flash:preview"), false);
  const deepseekFlash = models.find((model) => model.id === "deepseek-v4-flash");
  assert.equal(deepseekFlash?.contextLength, 1048576);
  assert.equal(deepseekFlash?.maxOutputTokens, 384000);
  assert.deepEqual(deepseekFlash?.capabilities, {
    imageInput: false,
    toolCalling: true,
    thinking: true,
  });
  assert.equal(models.some((model) => model.id === "deepseek-v4-pro:preview"), false);
  const deepseekPro = models.find((model) => model.id === "deepseek-v4-pro");
  assert.equal(deepseekPro?.contextLength, 1048576);
  assert.equal(deepseekPro?.maxOutputTokens, 384000);
  assert.deepEqual(deepseekPro?.capabilities, {
    imageInput: false,
    toolCalling: true,
    thinking: true,
  });
  const deepseekPro0813 = models.find((model) => model.id === "deepseek-v4-pro:0813");
  assert.equal(deepseekPro0813?.contextLength, 1048576);
  assert.equal(deepseekPro0813?.maxOutputTokens, 384000);
  assert.deepEqual(deepseekPro0813?.capabilities, {
    imageInput: false,
    toolCalling: true,
    thinking: true,
  });
  const kimi = models.find((model) => model.id === "kimi-k3");
  assert.equal(kimi?.contextLength, 1048576);
  assert.equal(kimi?.maxOutputTokens, 131072);
  assert.deepEqual(kimi?.capabilities, {
    imageInput: true,
    toolCalling: true,
    thinking: true,
  });
  const kimiK25 = models.find((model) => model.id === "kimi-k2.5");
  assert.equal(kimiK25?.contextLength, 262144);
  assert.equal(kimiK25?.maxOutputTokens, 262144);
  assert.deepEqual(kimiK25?.capabilities, {
    imageInput: true,
    toolCalling: true,
    thinking: true,
  });
  const minimaxM25 = models.find((model) => model.id === "minimax-m2.5");
  assert.equal(minimaxM25?.contextLength, 204800);
  assert.equal(minimaxM25?.maxOutputTokens, 131072);
  assert.deepEqual(minimaxM25?.capabilities, {
    imageInput: false,
    toolCalling: true,
    thinking: true,
  });
  const gemma = models.find((model) => model.id === "gemma4:31b");
  assert.equal(gemma?.contextLength, 262144);
  assert.equal(gemma?.maxOutputTokens, 262144);
  assert.deepEqual(gemma?.capabilities, {
    imageInput: true,
    toolCalling: true,
    thinking: true,
  });
});

test("ignores v1 cached retired models when a catalog refresh fails", async () => {
  const cache = new MemoryCache();
  cache.values.set("ollamaCloudCopilot.modelCatalog.v1.account", [{
    id: "deepseek-v4-flash:preview",
    name: "DeepSeek V4 Flash Preview",
    family: "deepseek",
    version: "preview",
    contextLength: 1048576,
    maxOutputTokens: 384000,
    capabilities: { imageInput: false, toolCalling: true, thinking: true },
  }]);

  const catalog = new ModelCatalog(
    cache,
    async () => new Response("unavailable", { status: 503 }),
    undefined,
    `${CATALOG_CACHE_KEY}.account`,
  );
  await assert.rejects(catalog.refresh("not-logged"));
  assert.equal(catalog.get("deepseek-v4-flash:preview"), undefined);
  assert.notEqual(catalog.get("deepseek-v4-flash"), undefined);
});

test("ignores v2 snapshots that predate the GLM 5.3 family", () => {
  const cache = new MemoryCache();
  cache.values.set("ollamaCloudCopilot.modelCatalog.v2", fallbackModels().filter((model) =>
    !model.id.startsWith("glm-5.3")
  ));

  const catalog = new ModelCatalog(cache);
  assert.notEqual(catalog.get("glm-5.3"), undefined);
  assert.notEqual(catalog.get("glm-5.3-flash"), undefined);
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

test("Models.dev enriches unknown models without overriding verified fallback limits", () => {
  const metadata = {
    id: "future-model:9b",
    contextLength: 131072,
    maxOutputTokens: 32768,
    imageInput: true,
    toolCalling: true,
    thinking: true,
  };
  const model = modelFromShow("future-model:9b", {}, undefined, metadata);
  assert.equal(model.contextLength, 131072);
  assert.equal(model.maxOutputTokens, 32768);
  assert.deepEqual(model.capabilities, {
    imageInput: true,
    toolCalling: true,
    thinking: true,
  });

  const verified = modelFromShow("gpt-oss:20b", {}, undefined, {
    id: "gpt-oss:20b",
    contextLength: 131072,
    maxOutputTokens: 32768,
    imageInput: false,
    toolCalling: true,
    thinking: true,
  });
  assert.equal(verified.maxOutputTokens, 131072);
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
  assert.equal(requests.length, 4);
  assert.equal(models.find((model) => model.id === "new-model")?.capabilities.imageInput, true);
  assert.equal(Array.isArray(cache.values.get(CATALOG_CACHE_KEY)), true);
});

test("persists account catalogs under isolated cache keys", async () => {
  const cache = new MemoryCache();
  const catalog = new ModelCatalog(cache, async (input) => {
    if (String(input).endsWith("/tags")) return Response.json({ models: [{ name: "gpt-oss:20b" }] });
    return Response.json({ capabilities: ["completion", "tools", "thinking"] });
  }, undefined, `${CATALOG_CACHE_KEY}.account`);

  await catalog.refresh("not-logged");
  assert.equal(cache.values.has(CATALOG_CACHE_KEY), false);
  assert.equal(Array.isArray(cache.values.get(`${CATALOG_CACHE_KEY}.account`)), true);
});

test("refresh uses cached Models.dev metadata for a newly discovered model", async () => {
  const cache = new MemoryCache();
  const catalog = new ModelCatalog(cache, async (input) => {
    const url = String(input);
    if (url === MODELS_DEV_API_URL) {
      return Response.json({
        "ollama-cloud": {
          models: {
            "new-model": {
              limit: { context: 64000, output: 16000 },
              attachment: true,
              modalities: { input: ["text", "image"], output: ["text"] },
              reasoning: true,
              tool_call: true,
            },
          },
        },
      });
    }
    if (url.endsWith("/tags")) return Response.json({ models: [{ name: "new-model" }] });
    return new Response("unavailable", { status: 503 });
  });

  const models = await catalog.refresh("not-logged");
  assert.deepEqual(models[0], {
    id: "new-model",
    name: "New Model",
    family: "new",
    version: "cloud",
    contextLength: 64000,
    maxOutputTokens: 16000,
    capabilities: { imageInput: true, toolCalling: true, thinking: true },
    retirementDate: undefined,
  });
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

test("does not infer tools or thinking when metadata for an unknown model fails", async () => {
  const catalog = new ModelCatalog(new MemoryCache(), async (input) => {
    if (String(input).endsWith("/tags")) return Response.json({ models: [{ name: "unknown-model" }] });
    return new Response("unavailable", { status: 503 });
  });
  const models = await catalog.refresh("not-logged");
  assert.deepEqual(models[0].capabilities, {
    imageInput: false,
    toolCalling: false,
    thinking: false,
  });
});

test("formats model identifiers for the picker", () => {
  assert.equal(humanizeModelId("gpt-oss:120b"), "GPT OSS 120B");
  assert.equal(humanizeModelId("deepseek-v4-flash:preview"), "DeepSeek V4 Flash Preview");
});
