import { type Fetch } from "../../models/catalog";
import { apiError } from "../../errors";
import { OLLAMA_ENDPOINTS, ollamaHeaders } from "../../transport/protocol";
import { searchCacheKey, type WebResultCache } from "./web-cache";

export const OLLAMA_WEB_SEARCH_TOOL_NAME = "ollama-cloud_web-search";
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS = 10;
const MAX_OUTPUT_CHARS = 12_000;
/** Snippet length per result; expand=<index> reads the full cached content. */
const SNIPPET_CHARS = 500;

export interface OllamaWebSearchInput {
  readonly query: string;
  readonly max_results?: number;
  /** Bypass the cached search and re-call the API; the fresh result replaces the cache entry. */
  readonly refresh?: boolean;
  /** 1-based index of a result to return in full from the cached search (0 extra API calls). */
  readonly expand?: number;
  readonly credential_capability?: string;
}

export interface OllamaWebSearchResult {
  readonly title: string;
  readonly url: string;
  readonly content: string;
}

export interface OllamaWebSearchResponse {
  readonly results: readonly OllamaWebSearchResult[];
  /** True when the response was served from the session cache. */
  readonly fromCache?: boolean;
}

export interface WebSearchCancellationToken {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

export function createWebSearchRequestCancellation(
  token: WebSearchCancellationToken,
): { controller: AbortController; cancellation: { dispose(): void } } {
  const controller = new AbortController();
  const cancellation = token.onCancellationRequested(() => controller.abort());
  if (token.isCancellationRequested) controller.abort();
  return { controller, cancellation };
}

export async function searchOllamaWeb(
  input: OllamaWebSearchInput,
  apiKey: string,
  signal?: AbortSignal,
  fetchImpl: Fetch = fetch,
  cache?: WebResultCache,
): Promise<OllamaWebSearchResponse> {
  const query = input.query.trim();
  if (!query) throw new Error("Ollama web search requires a non-empty query");
  if (!apiKey.trim()) throw new Error("Ollama Cloud API key is not configured");

  const maxResults = normalizeMaxResults(input.max_results);
  const key = searchCacheKey(query, maxResults);
  if (cache && input.refresh !== true) {
    const cached = cache.getSearch(key);
    if (cached) return { results: cached.results, fromCache: true };
  }

  const response = await fetchImpl(OLLAMA_ENDPOINTS.webSearch, {
    method: "POST",
    headers: ollamaHeaders(apiKey),
    body: JSON.stringify({ query, max_results: maxResults }),
    signal,
  });
  if (!response.ok) throw await apiError("Ollama web search failed", response);

  const parsed = parseSearchResponse(await response.json());
  // Search failures are never cached: a fixed key or an expired rate-limit
  // window should let the next retry through immediately.
  cache?.setSearch(key, { ts: Date.now(), results: parsed.results });
  return parsed;
}

export function formatOllamaWebSearch(
  query: string,
  response: OllamaWebSearchResponse,
  maxResults = DEFAULT_MAX_RESULTS,
): string {
  if (!response.results.length) {
    return `Search results for: ${JSON.stringify(query)}\n\nNo web search results were found.\n\n${provenance(response)}`;
  }

  const lines = response.results.map((result, index) => {
    const truncated = result.content.length > SNIPPET_CHARS;
    return [
      `${index + 1}. ${truncated ? "[truncated]" : "[complete]"} ${result.title || result.url}`,
      `URL: ${result.url}`,
      result.content.slice(0, SNIPPET_CHARS),
    ].join("\n");
  });
  if (response.results.some((result) => result.content.length > SNIPPET_CHARS)) {
    lines.push(
      "",
      `Expand: call ${OLLAMA_WEB_SEARCH_TOOL_NAME}(query=${JSON.stringify(query)}, `
        + `max_results=${maxResults}, expand=<index>) to read a [truncated] result in full — 0 extra API calls.`,
    );
  }
  const output = `Search results for: ${JSON.stringify(query)}\n\n${lines.join("\n\n")}\n\n${provenance(response)}`;
  return output.length <= MAX_OUTPUT_CHARS
    ? output
    : `${output.slice(0, MAX_OUTPUT_CHARS)}\n\n[Ollama web search results truncated]`;
}

/** Formats one result in full for expand mode; 0 extra API calls from the cached search. */
export function formatExpandedSearchResult(
  query: string,
  response: OllamaWebSearchResponse,
  expand: number,
): string {
  if (!Number.isInteger(expand) || expand < 1 || expand > response.results.length) {
    throw new Error(
      `Ollama web search expand: index ${expand} is out of range for ${response.results.length} result(s).`
        + " Use ollama-cloud_web-fetch to read a specific URL instead.",
    );
  }
  const result = response.results[expand - 1];
  return [
    `Result ${expand} of ${JSON.stringify(query)} (full content, ${result.content.length} chars):`,
    "",
    result.content,
    "",
    provenance(response),
  ].join("\n");
}

function provenance(response: OllamaWebSearchResponse): string {
  return response.fromCache ? "# from cache" : "# live query";
}

function normalizeMaxResults(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_RESULTS;
  if (!Number.isInteger(value) || value < 1 || value > MAX_RESULTS) {
    throw new Error(`Ollama web search max_results must be an integer from 1 to ${MAX_RESULTS}`);
  }
  return value;
}

function parseSearchResponse(value: unknown): OllamaWebSearchResponse {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    throw new Error("Ollama web search returned an invalid response");
  }

  return {
    results: value.results.flatMap((result): OllamaWebSearchResult[] => {
      if (!isRecord(result)) return [];
      const title = stringValue(result.title);
      const url = stringValue(result.url);
      const content = stringValue(result.content);
      return url || content ? [{ title, url, content }] : [];
    }),
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
