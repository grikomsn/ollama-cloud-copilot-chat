/**
 * Streamed native Ollama chat engine for inline completions.
 *
 * Sends a `think: false` fill-in-the-middle request to the fixed Ollama Cloud
 * `/api/chat` endpoint, parses the NDJSON stream, and returns only visible
 * message content — hidden thinking chunks are discarded so a thinking model
 * can never leak chain-of-thought into ghost text.
 */

import { buildCompletionPrompt, stripCodeFence } from "./prompt";
import type { CompletionContext, CompletionResult } from "./types";

export type Fetcher = typeof fetch;

export interface OllamaCompletionEngineOptions {
  readonly url: string;
  readonly apiKey: string;
  readonly userAgent?: string;
  readonly timeoutMs: number;
  readonly fetcher?: Fetcher;
  readonly log?: (message: string) => void;
}

/** Extract visible content from one NDJSON chat chunk. Pure. */
export function parseNdjsonContentDelta(line: string): string {
  if (!line.startsWith("{")) return "";
  let event: unknown;
  try {
    event = JSON.parse(line) as unknown;
  } catch {
    return "";
  }
  if (!event || typeof event !== "object") return "";
  const message = (event as { message?: unknown }).message;
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}

/** Decide whether one NDJSON chunk marks the end of the stream. Pure. */
export function isNdjsonDone(line: string): boolean {
  if (!line.startsWith("{")) return false;
  try {
    return (JSON.parse(line) as { done?: unknown }).done === true;
  } catch {
    return false;
  }
}

export class OllamaCompletionEngine {
  private readonly fetcher: Fetcher;

  constructor(private readonly options: OllamaCompletionEngineOptions) {
    this.fetcher = options.fetcher ?? fetch;
  }

  async complete(context: CompletionContext, signal: AbortSignal): Promise<CompletionResult> {
    const started = Date.now();
    const prompt = buildCompletionPrompt(context.prefix, context.suffix);
    const body = JSON.stringify({
      model: context.modelId,
      messages: prompt.messages,
      stream: true,
      think: false,
      options: { num_predict: context.maxTokens, temperature: 0 },
    });
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const requestSignal = AbortSignal.any([signal, timeout]);
    this.options.log?.(`[completions] model=${context.modelId} prefixChars=${context.prefix.length} suffixChars=${context.suffix.length}`);
    let response: Response;
    try {
      response = await this.fetcher(this.options.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
          ...(this.options.userAgent ? { "User-Agent": this.options.userAgent } : {}),
        },
        body,
        signal: requestSignal,
      });
    } catch (error) {
      if (signal.aborted) return { text: undefined, durationMs: Date.now() - started };
      throw new Error(`Ollama Cloud completion request failed: ${messageOf(error)}`);
    }
    if (!response.ok) {
      // Upstream error bodies can echo prompt context; never surface them.
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Ollama Cloud completion request failed (${response.status})`);
    }
    if (!response.body) throw new Error("Ollama Cloud returned an empty completion stream");
    const text = await readContentStream(response.body, requestSignal);
    const clean = stripCodeFence(text);
    return { text: clean.trim() ? clean : undefined, durationMs: Date.now() - started };
  }
}

async function readContentStream(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        content += parseNdjsonContentDelta(line);
        if (isNdjsonDone(line)) return content;
      }
    }
  } finally {
    reader.releaseLock();
    if (signal.aborted) await reader.cancel().catch(() => undefined);
  }
  return content;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
