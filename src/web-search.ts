import { type Fetch, OLLAMA_CLOUD_API } from "./catalog";
import { apiError } from "./errors";

export const OLLAMA_WEB_SEARCH_TOOL_NAME = "ollama-cloud_web-search";
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS = 10;
const MAX_OUTPUT_CHARS = 12_000;

export interface OllamaWebSearchInput {
  readonly query: string;
  readonly max_results?: number;
}

export interface OllamaWebSearchResult {
  readonly title: string;
  readonly url: string;
  readonly content: string;
}

export interface OllamaWebSearchResponse {
  readonly results: readonly OllamaWebSearchResult[];
}

export async function searchOllamaWeb(
  input: OllamaWebSearchInput,
  apiKey: string,
  signal?: AbortSignal,
  fetchImpl: Fetch = fetch,
): Promise<OllamaWebSearchResponse> {
  const query = input.query.trim();
  if (!query) throw new Error("Ollama web search requires a non-empty query");
  if (!apiKey.trim()) throw new Error("Ollama Cloud API key is not configured");

  const maxResults = normalizeMaxResults(input.max_results);
  const response = await fetchImpl(`${OLLAMA_CLOUD_API}/web_search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, max_results: maxResults }),
    signal,
  });
  if (!response.ok) throw await apiError("Ollama web search failed", response);

  return parseSearchResponse(await response.json());
}

export function formatOllamaWebSearch(
  query: string,
  response: OllamaWebSearchResponse,
): string {
  const lines = [`Search results for: ${JSON.stringify(query)}`];
  if (!response.results.length) {
    lines.push("", "No web search results were found.");
    return lines.join("\n");
  }

  response.results.forEach((result, index) => {
    lines.push(
      "",
      `${index + 1}. ${result.title || result.url}`,
      `URL: ${result.url}`,
      `Content: ${result.content}`,
    );
  });
  const output = lines.join("\n");
  return output.length <= MAX_OUTPUT_CHARS
    ? output
    : `${output.slice(0, MAX_OUTPUT_CHARS)}\n\n[Ollama web search results truncated]`;
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
