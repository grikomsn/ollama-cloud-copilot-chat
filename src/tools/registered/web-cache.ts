import { createHash } from "node:crypto";
import type { OllamaWebSearchResult } from "./web-search-client";

/** Success cache TTL for searches and fetched pages (plan R6). */
export const SEARCH_SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
/** Negative-cache TTL for failed page fetches. */
export const NEGATIVE_TTL_MS = 15 * 60 * 1000;

export interface CachedSearchEntry {
  readonly ts: number;
  readonly results: readonly OllamaWebSearchResult[];
}

export interface CachedPageEntry {
  readonly ts: number;
  readonly status?: number;
  readonly title?: string;
  readonly content?: string;
  readonly links?: readonly string[];
  readonly error?: string;
}

export interface WebResultCache {
  getSearch(key: string): CachedSearchEntry | undefined;
  setSearch(key: string, entry: CachedSearchEntry): void;
  getPage(url: string): CachedPageEntry | undefined;
  setPage(url: string, entry: CachedPageEntry): void;
}

/**
 * Decides whether a cached entry may still be served. Successes live for the
 * success TTL; failures (negative cache) for the shorter failure TTL. A
 * future timestamp (hand-edited state, clock skew) is treated as stale.
 */
export function isFreshCacheEntry(
  entry: { ts: number; error?: string } | undefined,
  now: number,
  successTtlMs = SEARCH_SUCCESS_TTL_MS,
  failTtlMs = NEGATIVE_TTL_MS,
): boolean {
  if (!entry) return false;
  if (entry.ts > now) return false;
  return now - entry.ts < (entry.error !== undefined ? failTtlMs : successTtlMs);
}

/** Cache key for a search: the same query with a different max_results is a different search. */
export function searchCacheKey(query: string, maxResults: number): string {
  return createHash("sha1").update(`${query}\n${maxResults}`).digest("hex");
}

/**
 * Session-scoped in-memory result cache. Deliberately not persisted (plan R6
 * adapted pi-ollama-cloud's disk cache: an in-memory VS Code session cache
 * avoids the durability machinery — size caps, eviction, file permissions —
 * while still saving API calls for repeated searches and page reads).
 */
export function createWebResultCache(now: () => number = Date.now): WebResultCache {
  const searches = new Map<string, CachedSearchEntry>();
  const pages = new Map<string, CachedPageEntry>();
  return {
    getSearch(key) {
      const entry = searches.get(key);
      if (!isFreshCacheEntry(entry, now())) return undefined;
      return entry;
    },
    setSearch(key, entry) {
      searches.set(key, entry);
    },
    getPage(url) {
      const entry = pages.get(url);
      if (!isFreshCacheEntry(entry, now())) return undefined;
      return entry;
    },
    setPage(url, entry) {
      pages.set(url, entry);
    },
  };
}
