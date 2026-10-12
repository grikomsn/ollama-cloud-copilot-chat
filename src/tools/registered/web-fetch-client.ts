import { type Fetch } from "../../models/catalog";
import { apiError } from "../../errors";
import { OLLAMA_ENDPOINTS, ollamaHeaders } from "../../transport/protocol";
import type { WebResultCache } from "./web-cache";

export const OLLAMA_WEB_FETCH_TOOL_NAME = "ollama-cloud_web-fetch";
/** Slice size for one read of a fetched page; the model pages with offset. */
const READ_CHUNK_CHARS = 3_000;
const MAX_LINKS_SHOWN = 10;
const MAX_OUTPUT_CHARS = 12_000;

export interface OllamaWebFetchInput {
  readonly url: string;
  readonly offset?: number;
  readonly full?: boolean;
  /** Bypass the cached page (or cached failure) and re-call the API. */
  readonly refresh?: boolean;
  readonly credential_capability?: string;
}

export interface OllamaWebFetchResponse {
  readonly title: string;
  readonly content: string;
  readonly links: readonly string[];
  /** True when the response was served from the session cache. */
  readonly fromCache?: boolean;
}

export async function fetchOllamaWeb(
  input: OllamaWebFetchInput,
  apiKey: string,
  signal?: AbortSignal,
  fetchImpl: Fetch = fetch,
  cache?: WebResultCache,
): Promise<OllamaWebFetchResponse> {
  const url = normalizeUrl(input.url);
  if (!apiKey.trim()) throw new Error("Ollama Cloud API key is not configured");
  // Offset validation happens here so bad input fails before the API call;
  // slicing itself happens at format time.
  normalizeOffset(input.offset);

  if (cache && input.refresh !== true) {
    const cached = cache.getPage(url);
    if (cached) {
      if (cached.error !== undefined) {
        throw new Error(webFetchFailureMessage(url, cached.status ?? 0, cached.error, { cached: true }));
      }
      return {
        title: cached.title ?? "",
        content: cached.content ?? "",
        links: cached.links ?? [],
        fromCache: true,
      };
    }
  }

  const response = await fetchImpl(OLLAMA_ENDPOINTS.webFetch, {
    method: "POST",
    headers: ollamaHeaders(apiKey),
    body: JSON.stringify({ url }),
    signal,
  });
  if (!response.ok) {
    const detail = await apiError("Ollama web fetch failed", response);
    // Negative cache only durable page properties: auth (401/403), rate
    // limits (429), server (5xx), and transport failures are never cached so
    // a fixed key or a transient blip lets the next retry through.
    const cacheable = isNegativeCacheableStatus(response.status);
    if (cache && cacheable) {
      cache.setPage(url, { ts: Date.now(), status: response.status, error: detail.message });
    }
    throw new Error(webFetchFailureMessage(url, response.status, detail.message, { cached: cacheable }));
  }
  const parsed = parseFetchResponse(await response.json());
  cache?.setPage(url, { ts: Date.now(), title: parsed.title, content: parsed.content, links: parsed.links });
  return parsed;
}

function isNegativeCacheableStatus(status: number): boolean {
  return status !== 401 && status !== 403 && status !== 429 && status < 500;
}

/** Parses a web_fetch payload: string title/content and string links (or null). */
export function parseFetchResponse(value: unknown): OllamaWebFetchResponse {
  if (!isRecord(value) || typeof value.title !== "string" || typeof value.content !== "string") {
    throw new Error("Ollama web fetch returned an invalid response");
  }
  if (value.links !== null && value.links !== undefined && !Array.isArray(value.links)) {
    throw new Error("Ollama web fetch returned an invalid response");
  }
  const links = Array.isArray(value.links)
    ? value.links.filter((link): link is string => typeof link === "string")
    : [];
  return { title: value.title, content: value.content, links };
}

/**
 * Builds a failure message with likely causes and next steps, following the
 * pi-ollama-cloud web-fetch diagnostics (plan R1). Transport-level failures
 * (timeouts, cancellation) surface as thrown AbortErrors before this point.
 */
export function webFetchFailureMessage(
  url: string,
  status: number,
  error?: string,
  options?: { cached?: boolean },
): string {
  const lines = [`Ollama Cloud fetch failed for ${url}: HTTP ${status}`];
  if (status === 401 || status === 403) {
    lines.push(
      "Likely cause: authentication error.",
      "Suggestion: re-check the API key bound to this model in Manage Language Models, then retry.",
    );
  } else if (status === 429) {
    lines.push("Likely cause: rate limited.", "Suggestion: try again shortly.");
  } else if (status >= 500) {
    lines.push("Likely cause: Ollama Cloud server error.", "Suggestion: try again shortly.");
  } else if (status === 400 || status === 404 || status === 422) {
    lines.push(
      "Likely cause: malformed or unsupported URL.",
      "Suggestion: check the URL; use ollama-cloud_web-search for the site or topic instead.",
    );
  } else {
    lines.push(
      "Likely cause: anti-bot or login wall, JavaScript-rendered page, or a malformed URL.",
      "Suggestion: 1) use ollama-cloud_web-search for the site or topic; 2) check the URL; 3) retrying with offset/full will also fail.",
    );
  }
  if (error?.trim()) lines.push(`API error: ${error.trim()}`);
  if (options?.cached) {
    lines.push("Status: failure cached for 15 min; pass refresh=true to force a live retry.");
  }
  return lines.join("\n");
}

/** Formats a fetch response: title, one 3000-char slice, pagination hint, and first-call links. */
export function formatOllamaWebFetch(
  input: OllamaWebFetchInput,
  response: OllamaWebFetchResponse,
): string {
  const url = normalizeUrl(input.url);
  const start = normalizeOffset(input.offset);
  const full = input.full === true;
  const content = response.content;
  const total = content.length;
  const end = full ? total : Math.min(start + READ_CHUNK_CHARS, total);
  const lines = [
    `Title: ${response.title} (${total} chars total)`,
    start >= total
      ? "Already at the end, no more content."
      : `Chars ${start + 1}-${end} of ${total}${end < total ? ` (${total - end} remaining)` : ""}:`,
    content.slice(start, end),
  ];
  if (!full && end < total) {
    lines.push("", `Continue: call ${OLLAMA_WEB_FETCH_TOOL_NAME}(url=${JSON.stringify(url)}, offset=${end})`);
  }
  if (start === 0 && !full) {
    lines.push("", `Links (${response.links.length}):`);
    lines.push(...response.links.slice(0, MAX_LINKS_SHOWN).map((link) => `  - ${link}`));
  }
  const output = lines.join("\n");
  const bounded = output.length <= MAX_OUTPUT_CHARS
    ? output
    : `${output.slice(0, MAX_OUTPUT_CHARS)}\n\n[Ollama web fetch output truncated]`;
  return `${bounded}\n\n${response.fromCache ? "# from cache" : "# live query"}`;
}

function normalizeUrl(value: string): string {
  const url = value.trim();
  if (!url) throw new Error("Ollama web fetch requires a URL");
  if (!/^https?:\/\//i.test(url)) throw new Error("Ollama web fetch requires an http(s) URL");
  return url;
}

function normalizeOffset(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Ollama web fetch offset must be a non-negative integer");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
