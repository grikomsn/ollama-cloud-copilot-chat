import assert from "node:assert/strict";
import test from "node:test";
import {
  NEGATIVE_TTL_MS,
  SEARCH_SUCCESS_TTL_MS,
  createWebResultCache,
  isFreshCacheEntry,
  searchCacheKey,
} from "./web-cache";

test("serves fresh entries within the success TTL and drops them after", () => {
  const base = 1_000_000;
  assert.equal(isFreshCacheEntry({ ts: base }, base + SEARCH_SUCCESS_TTL_MS - 1), true);
  assert.equal(isFreshCacheEntry({ ts: base }, base + SEARCH_SUCCESS_TTL_MS), false);
  assert.equal(isFreshCacheEntry({ ts: base }, base + SEARCH_SUCCESS_TTL_MS + 1), false);
});

test("applies the shorter negative TTL to failed entries", () => {
  const base = 1_000_000;
  const failed = { ts: base, error: "HTTP 404" };
  assert.equal(isFreshCacheEntry(failed, base + NEGATIVE_TTL_MS - 1), true);
  assert.equal(isFreshCacheEntry(failed, base + NEGATIVE_TTL_MS + 1), false);
  assert.equal(isFreshCacheEntry({ ts: base }, base + NEGATIVE_TTL_MS + 1), true);
});

test("treats missing and future-dated entries as stale", () => {
  assert.equal(isFreshCacheEntry(undefined, 1_000), false);
  assert.equal(isFreshCacheEntry({ ts: 2_000 }, 1_000), false);
});

test("cache keys separate searches by query and result count", () => {
  assert.equal(searchCacheKey("news", 5), searchCacheKey("news", 5));
  assert.notEqual(searchCacheKey("news", 5), searchCacheKey("news", 10));
  assert.notEqual(searchCacheKey("news", 5), searchCacheKey("more news", 5));
});

test("stores and serves search results and pages within their TTLs", () => {
  let now = 1_000_000;
  const cache = createWebResultCache(() => now);
  const key = searchCacheKey("query", 5);
  cache.setSearch(key, { ts: now, results: [{ title: "t", url: "u", content: "c" }] });
  assert.deepEqual(cache.getSearch(key)?.results, [{ title: "t", url: "u", content: "c" }]);

  now += SEARCH_SUCCESS_TTL_MS + 1;
  assert.equal(cache.getSearch(key), undefined);

  cache.setPage("https://example.com", { ts: now, title: "Page", content: "body", links: ["a"] });
  assert.equal(cache.getPage("https://example.com")?.title, "Page");

  const failed = { ts: now, status: 404, error: "HTTP 404" };
  cache.setPage("https://example.com/dead", failed);
  now += NEGATIVE_TTL_MS + 1;
  assert.equal(cache.getPage("https://example.com/dead"), undefined);
});
