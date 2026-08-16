import assert from "node:assert/strict";
import test from "node:test";
import { type Fetch } from "../../models/catalog";
import {
  createWebSearchRequestCancellation,
  formatOllamaWebSearch,
  searchOllamaWeb,
  type OllamaWebSearchResponse,
} from "./web-search-client";

test("posts a bounded Ollama web search request and parses results", async () => {
  let request: { input: string | URL | Request; init?: RequestInit } | undefined;
  const fetchImpl: Fetch = async (input, init) => {
    request = { input, init };
    return new Response(JSON.stringify({
      results: [{ title: "Ollama", url: "https://ollama.com", content: "Cloud models" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const response = await searchOllamaWeb(
    { query: "  latest Ollama news  ", max_results: 3 },
    "test-key",
    undefined,
    fetchImpl,
  );

  assert.deepEqual(response.results, [
    { title: "Ollama", url: "https://ollama.com", content: "Cloud models" },
  ]);
  assert.equal(request?.input, "https://ollama.com/api/web_search");
  assert.equal(request?.init?.method, "POST");
  assert.equal(request?.init?.headers instanceof Object, true);
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    query: "latest Ollama news",
    max_results: 3,
  });
});

test("uses Ollama's default result count and rejects invalid search input", async () => {
  let body = "";
  const fetchImpl: Fetch = async (_input, init) => {
    body = String(init?.body);
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  };

  await searchOllamaWeb({ query: "query" }, "test-key", undefined, fetchImpl);
  assert.deepEqual(JSON.parse(body), { query: "query", max_results: 5 });
  await assert.rejects(
    searchOllamaWeb({ query: "" }, "test-key", undefined, fetchImpl),
    /non-empty query/,
  );
  await assert.rejects(
    searchOllamaWeb({ query: "query", max_results: 11 }, "test-key", undefined, fetchImpl),
    /max_results must be an integer/,
  );
});

test("formats results for a language-model tool result and bounds large output", () => {
  const response: OllamaWebSearchResponse = {
    results: [{
      title: "A result",
      url: "https://example.com",
      content: "x".repeat(20_000),
    }],
  };

  const output = formatOllamaWebSearch("test query", response);
  assert.match(output, /Search results for: \"test query\"/);
  assert.match(output, /https:\/\/example\.com/);
  assert.match(output, /results truncated/);
  assert.ok(output.length < 12_100);
});

test("aborts a web search request when cancellation was already requested", () => {
  const token = {
    isCancellationRequested: true,
    onCancellationRequested: () => ({ dispose: () => {} }),
  };

  const { controller, cancellation } = createWebSearchRequestCancellation(token);

  assert.equal(controller.signal.aborted, true);
  cancellation.dispose();
});

test("aborts a web search request when cancellation arrives later", () => {
  let cancel: (() => void) | undefined;
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: (listener: () => void) => {
      cancel = listener;
      return { dispose: () => {} };
    },
  };

  const { controller, cancellation } = createWebSearchRequestCancellation(token);
  assert.equal(controller.signal.aborted, false);
  cancel?.();
  assert.equal(controller.signal.aborted, true);
  cancellation.dispose();
});
