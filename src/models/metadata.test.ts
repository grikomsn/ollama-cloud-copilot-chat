import assert from "node:assert/strict";
import test from "node:test";
import {
  MODELS_DEV_API_URL,
  MODELS_DEV_CACHE_KEY,
  MODELS_DEV_CACHE_TTL_MS,
  ModelsDevMetadata,
  normalizeModelsDevSnapshot,
  parseCachedModelsDevSnapshot,
  type MetadataCache,
} from "./metadata";

class MemoryCache implements MetadataCache {
  readonly values = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

const payload = {
  "ollama-cloud": {
    models: {
      "future-model:9b": {
        id: "future-model:9b",
        name: "future-model:9b",
        description: "A future Cloud model",
        family: "future",
        attachment: true,
        reasoning: true,
        reasoning_options: [
          { type: "toggle" },
          { type: "effort", values: ["low", "high"] },
        ],
        tool_call: true,
        temperature: false,
        release_date: "2026-01-01",
        last_updated: "2026-02-01",
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 131072, output: 32768 },
      },
    },
  },
};

test("normalizes the ollama-cloud Models.dev provider", () => {
  const snapshot = normalizeModelsDevSnapshot(payload, 123);
  assert.equal(snapshot.fetchedAt, 123);
  assert.deepEqual(snapshot.models["future-model:9b"], {
    id: "future-model:9b",
    name: "future-model:9b",
    description: "A future Cloud model",
    family: "future",
    contextLength: 131072,
    maxOutputTokens: 32768,
    imageInput: true,
    toolCalling: true,
    thinking: true,
    reasoningOptions: ["toggle", "low", "high"],
    temperature: false,
    releaseDate: "2026-01-01",
    lastUpdated: "2026-02-01",
  });
});

test("does not treat generic attachments as image input", () => {
  const snapshot = normalizeModelsDevSnapshot({
    "ollama-cloud": {
      models: {
        "text-model": {
          attachment: true,
          modalities: { input: ["text"], output: ["text"] },
        },
      },
    },
  }, 123);
  assert.equal(snapshot.models["text-model"]?.imageInput, false);
});

test("rejects malformed or unrelated provider payloads", () => {
  assert.throws(() => normalizeModelsDevSnapshot({ models: {} }, 1));
  assert.equal(parseCachedModelsDevSnapshot({ fetchedAt: 1, models: [] }), undefined);
  assert.equal(parseCachedModelsDevSnapshot({ fetchedAt: -1, models: {} }), undefined);
});

test("caches a successful snapshot and reuses a fresh cache", async () => {
  const cache = new MemoryCache();
  let now = 1000;
  let calls = 0;
  const metadata = new ModelsDevMetadata(cache, async (input) => {
    calls += 1;
    assert.equal(String(input), MODELS_DEV_API_URL);
    return Response.json(payload);
  }, () => now);

  const first = await metadata.getOrRefresh();
  const second = await metadata.getOrRefresh();
  assert.equal(first, second);
  assert.equal(calls, 1);
  assert.deepEqual(cache.values.get(MODELS_DEV_CACHE_KEY), first);

  now += MODELS_DEV_CACHE_TTL_MS - 1;
  assert.equal(await metadata.getOrRefresh(), first);
  assert.equal(calls, 1);
});

test("returns stale metadata while refreshing in the background", async () => {
  const cache = new MemoryCache();
  const stale = normalizeModelsDevSnapshot(payload, 1000);
  cache.values.set(MODELS_DEV_CACHE_KEY, stale);
  let now = stale.fetchedAt + MODELS_DEV_CACHE_TTL_MS + 1;
  let calls = 0;
  const metadata = new ModelsDevMetadata(cache, async () => {
    calls += 1;
    return Response.json({
      "ollama-cloud": { models: { "new-model": { limit: { context: 64000, output: 16000 } } } },
    });
  }, () => now);

  const returned = await metadata.getOrRefresh();
  assert.deepEqual(returned, stale);
  assert.equal(calls, 1);
  const refreshed = await metadata.refresh();
  assert.equal(refreshed.models["new-model"]?.contextLength, 64000);
  assert.equal(refreshed.fetchedAt, now);
});

test("falls back to cached metadata when refresh fails", async () => {
  const cache = new MemoryCache();
  const stale = normalizeModelsDevSnapshot(payload, 1000);
  cache.values.set(MODELS_DEV_CACHE_KEY, stale);
  const metadata = new ModelsDevMetadata(cache, async () => new Response("unavailable", { status: 503 }), () => 999999);

  assert.equal((await metadata.refresh()).models["future-model:9b"]?.contextLength, 131072);
});
