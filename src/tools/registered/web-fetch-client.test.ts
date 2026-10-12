import assert from "node:assert/strict";
import test from "node:test";
import { type Fetch } from "../../models/catalog";
import {
  fetchOllamaWeb,
  formatOllamaWebFetch,
  OLLAMA_WEB_FETCH_TOOL_NAME,
  parseFetchResponse,
  webFetchFailureMessage,
  type OllamaWebFetchResponse,
} from "./web-fetch-client";
import { createWebResultCache } from "./web-cache";

test("posts a bounded Ollama web fetch request and parses the page", async () => {
  let request: { input: string | URL | Request; init?: RequestInit } | undefined;
  const fetchImpl: Fetch = async (input, init) => {
    request = { input, init };
    return new Response(JSON.stringify({
      title: "Example page",
      content: "Page body".repeat(10),
      links: ["https://example.com/a", "https://example.com/b"],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const response = await fetchOllamaWeb(
    { url: "  https://example.com/page  " },
    "test-key",
    undefined,
    fetchImpl,
  );

  assert.equal(response.title, "Example page");
  assert.equal(response.links.length, 2);
  assert.equal(request?.input, "https://ollama.com/api/web_fetch");
  assert.equal(request?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), { url: "https://example.com/page" });
});

test("parses strict web fetch payloads", () => {
  assert.deepEqual(parseFetchResponse({ title: "t", content: "c", links: null }), {
    title: "t",
    content: "c",
    links: [],
  });
  assert.deepEqual(parseFetchResponse({ title: "t", content: "c", links: ["a", 5, "b"] }).links, ["a", "b"]);
  assert.throws(() => parseFetchResponse({ title: "t", content: "c", links: "nope" }), /invalid response/);
  assert.throws(() => parseFetchResponse({ title: 5, content: "c" }), /invalid response/);
  assert.throws(() => parseFetchResponse("nope"), /invalid response/);
});

test("rejects invalid fetch input before calling the API", async () => {
  const fetchImpl: Fetch = async () => {
    throw new Error("should not be called");
  };
  await assert.rejects(fetchOllamaWeb({ url: "" }, "k", undefined, fetchImpl), /requires a URL/);
  await assert.rejects(fetchOllamaWeb({ url: "ftp://example.com" }, "k", undefined, fetchImpl), /http\(s\) URL/);
  await assert.rejects(
    fetchOllamaWeb({ url: "https://example.com", offset: -1 }, "k", undefined, fetchImpl),
    /non-negative integer/,
  );
  await assert.rejects(
    fetchOllamaWeb({ url: "https://example.com", offset: 1.5 }, "k", undefined, fetchImpl),
    /non-negative integer/,
  );
  await assert.rejects(fetchOllamaWeb({ url: "https://example.com" }, "  ", undefined, fetchImpl), /not configured/);
});

test("formats a sliced page with a pagination hint and first-call links", () => {
  const response: OllamaWebFetchResponse = {
    title: "Long page",
    content: "x".repeat(8_000),
    links: ["https://example.com/1", "https://example.com/2"],
  };

  const first = formatOllamaWebFetch({ url: "https://example.com" }, response);
  assert.match(first, /Title: Long page \(8000 chars total\)/);
  assert.match(first, /Chars 1-3000 of 8000 \(5000 remaining\)/);
  assert.match(first, new RegExp(`Continue: call ${OLLAMA_WEB_FETCH_TOOL_NAME}\\(url="https://example.com", offset=3000\\)`));
  assert.match(first, /Links \(2\)/);
  assert.match(first, /https:\/\/example\.com\/1/);

  const second = formatOllamaWebFetch({ url: "https://example.com", offset: 3000 }, response);
  assert.match(second, /Chars 3001-6000 of 8000/);
  assert.doesNotMatch(second, /Links \(/);
});

test("returns remaining content with full and bounds very large output", () => {
  const response: OllamaWebFetchResponse = {
    title: "Huge page",
    content: "y".repeat(40_000),
    links: [],
  };

  const complete = formatOllamaWebFetch(
    { url: "https://example.com", full: true },
    { title: "Page", content: "y".repeat(8_000), links: [] },
  );
  assert.doesNotMatch(complete, /Continue: call/);
  assert.doesNotMatch(complete, /Links \(/);
  assert.match(complete, /Chars 1-8000 of 8000/);

  const bounded = formatOllamaWebFetch({ url: "https://example.com", full: true }, response);
  assert.match(bounded, /output truncated/);
  assert.ok(bounded.length < 12_100);
});

test("reports when the offset is past the end of the page", () => {
  const output = formatOllamaWebFetch(
    { url: "https://example.com", offset: 5 },
    { title: "t", content: "abc", links: [] },
  );
  assert.match(output, /Already at the end, no more content\./);
});

test("caches fetched pages and serves repeats at 0 extra API calls", async () => {
  let calls = 0;
  const fetchImpl: Fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ title: "Page", content: "body", links: null }), { status: 200 });
  };
  const cache = createWebResultCache();

  const first = await fetchOllamaWeb({ url: "https://example.com" }, "k", undefined, fetchImpl, cache);
  assert.equal(first.fromCache, undefined);
  assert.equal(calls, 1);

  const second = await fetchOllamaWeb({ url: "https://example.com" }, "k", undefined, fetchImpl, cache);
  assert.equal(second.fromCache, true);
  assert.equal(second.title, "Page");
  assert.equal(calls, 1);
  assert.match(formatOllamaWebFetch({ url: "https://example.com" }, second), /# from cache/);

  const refreshed = await fetchOllamaWeb(
    { url: "https://example.com", refresh: true }, "k", undefined, fetchImpl, cache,
  );
  assert.equal(refreshed.fromCache, undefined);
  assert.equal(calls, 2);
});

test("negative-caches only durable page failures", async () => {
  const cache = createWebResultCache();
  const notFound: Fetch = async () => new Response("missing", { status: 404 });
  await assert.rejects(fetchOllamaWeb({ url: "https://example.com/dead" }, "k", undefined, notFound, cache), /HTTP 404/);
  await assert.rejects(
    fetchOllamaWeb({ url: "https://example.com/dead" }, "k", undefined, notFound, cache),
    /failure cached for 15 min/,
  );

  // Auth, rate-limit, and server failures are never cached: each retry hits
  // the API again so a fixed key or a recovered server lets it through.
  const unauthorized: Fetch = async () => new Response("no", { status: 401 });
  await assert.rejects(fetchOllamaWeb({ url: "https://example.com/locked" }, "k", undefined, unauthorized, cache), /authentication error/);
  await assert.rejects(fetchOllamaWeb({ url: "https://example.com/locked" }, "k", undefined, unauthorized, cache), /authentication error/);
  const rateLimited: Fetch = async () => new Response("slow down", { status: 429 });
  await assert.rejects(fetchOllamaWeb({ url: "https://example.com/busy" }, "k", undefined, rateLimited, cache), /rate limited/);
  await assert.rejects(fetchOllamaWeb({ url: "https://example.com/busy" }, "k", undefined, rateLimited, cache), /rate limited/);
  const serverError: Fetch = async () => new Response("boom", { status: 503 });
  await assert.rejects(fetchOllamaWeb({ url: "https://example.com/down" }, "k", undefined, serverError, cache), /server error/);
  await assert.rejects(fetchOllamaWeb({ url: "https://example.com/down" }, "k", undefined, serverError, cache), /server error/);
});

test("builds failure diagnostics with likely causes", () => {
  assert.match(webFetchFailureMessage("https://example.com", 401, "bad key"), /authentication error/);
  assert.match(webFetchFailureMessage("https://example.com", 429), /rate limited/);
  assert.match(webFetchFailureMessage("https://example.com", 503), /server error/);
  assert.match(webFetchFailureMessage("https://example.com", 400), /malformed or unsupported URL/);
  assert.match(webFetchFailureMessage("https://example.com", 418), /anti-bot or login wall/);
  assert.match(
    webFetchFailureMessage("https://example.com", 403, "forbidden"),
    /API error: forbidden/,
  );
});

test("surfaces failure diagnostics when the API rejects the fetch", async () => {
  const fetchImpl: Fetch = async () => new Response("nope", { status: 403 });
  await assert.rejects(
    fetchOllamaWeb({ url: "https://example.com/private" }, "k", undefined, fetchImpl),
    (error: Error) => /authentication error/.test(error.message) && /HTTP 403/.test(error.message),
  );
});
