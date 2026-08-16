import assert from "node:assert/strict";
import test from "node:test";
import { OLLAMA_CLOUD_API, OLLAMA_CLOUD_ORIGIN, OLLAMA_ENDPOINTS, ollamaHeaders } from "./protocol";

test("centralizes Ollama Cloud endpoints", () => {
  assert.equal(OLLAMA_CLOUD_ORIGIN, "https://ollama.com");
  assert.equal(OLLAMA_CLOUD_API, "https://ollama.com/api");
  assert.deepEqual(OLLAMA_ENDPOINTS, {
    chat: "https://ollama.com/api/chat",
    models: "https://ollama.com/api/tags",
    model: "https://ollama.com/api/show",
    usage: "https://ollama.com/api/usage",
    webSearch: "https://ollama.com/api/web_search",
  });
});

test("builds authenticated headers with an optional request identity", () => {
  assert.deepEqual(ollamaHeaders("secret"), {
    Authorization: "Bearer secret",
    "Content-Type": "application/json",
    Accept: "application/json",
  });
  assert.equal(ollamaHeaders("secret", "application/x-ndjson", "extension/1.0")["User-Agent"], "extension/1.0");
});
