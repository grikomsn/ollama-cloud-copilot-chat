import assert from "node:assert/strict";
import test from "node:test";
import { type Fetch } from "../../models/catalog";
import {
  createWebSearchRequestCancellation,
  formatExpandedSearchResult,
  formatOllamaWebSearch,
  searchOllamaWeb,
  type OllamaWebSearchResponse,
} from "./web-search-client";
import { createWebResultCache } from "./web-cache";

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

test("formats results with truncated markers, an expand hint, and a provenance footer", () => {
  const response: OllamaWebSearchResponse = {
    results: [
      { title: "A result", url: "https://example.com", content: "x".repeat(20_000) },
      { title: "Short result", url: "https://example.org", content: "tiny" },
    ],
  };

  const output = formatOllamaWebSearch("test query", response, 5);
  assert.match(output, /Search results for: \"test query\"/);
  assert.match(output, /1\. \[truncated\] A result/);
  assert.match(output, /2\. \[complete\] Short result/);
  assert.match(
    output,
    /Expand: call ollama-cloud_web-search\(query=\"test query\", max_results=5, expand=<index>\)/,
  );
  assert.match(output, /# live query/);
  const cachedOutput = formatOllamaWebSearch("test query", { ...response, fromCache: true }, 5);
  assert.match(cachedOutput, /# from cache/);
});

test("expands a cached result in full and rejects out-of-range indexes", () => {
  const response: OllamaWebSearchResponse = {
    fromCache: true,
    results: [{ title: "A result", url: "https://example.com", content: "full content" }],
  };
  const output = formatExpandedSearchResult("news", response, 1);
  assert.match(output, /Result 1 of \"news\" \(full content, 12 chars\)/);
  assert.match(output, /full content/);
  assert.match(output, /# from cache/);
  assert.throws(() => formatExpandedSearchResult("news", response, 2), /out of range/);
  assert.throws(() => formatExpandedSearchResult("news", response, 0), /out of range/);
});

test("serves repeat searches from the session cache at 0 extra API calls", async () => {
  let calls = 0;
  const fetchImpl: Fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      results: [{ title: "t", url: "https://example.com", content: "c".repeat(600) }],
    }), { status: 200 });
  };
  const cache = createWebResultCache();

  const first = await searchOllamaWeb({ query: "news", max_results: 5 }, "k", undefined, fetchImpl, cache);
  assert.equal(first.fromCache, undefined);
  assert.equal(calls, 1);

  const second = await searchOllamaWeb({ query: "news", max_results: 5 }, "k", undefined, fetchImpl, cache);
  assert.equal(second.fromCache, true);
  assert.equal(calls, 1);

  const refreshed = await searchOllamaWeb(
    { query: "news", max_results: 5, refresh: true }, "k", undefined, fetchImpl, cache,
  );
  assert.equal(refreshed.fromCache, undefined);
  assert.equal(calls, 2);

  // The cache key includes max_results, so a different count is a new search.
  const otherCount = await searchOllamaWeb({ query: "news", max_results: 10 }, "k", undefined, fetchImpl, cache);
  assert.equal(otherCount.fromCache, undefined);
  assert.equal(calls, 3);
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
