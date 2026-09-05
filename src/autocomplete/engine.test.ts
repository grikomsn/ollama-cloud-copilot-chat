import assert from "node:assert/strict";
import test from "node:test";
import { isNdjsonDone, OllamaCompletionEngine, parseNdjsonContentDelta } from "./engine";

function ndjsonResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
}

test("parses visible content and ignores thinking chunks", () => {
  assert.equal(
    parseNdjsonContentDelta(JSON.stringify({ message: { content: "code" } })),
    "code",
  );
  assert.equal(
    parseNdjsonContentDelta(JSON.stringify({ message: { content: "", thinking: "secret" } })),
    "",
  );
  assert.equal(parseNdjsonContentDelta("not json"), "");
  assert.equal(parseNdjsonContentDelta(JSON.stringify({ done: true })), "");
});

test("detects the done chunk", () => {
  assert.equal(isNdjsonDone(JSON.stringify({ done: true })), true);
  assert.equal(isNdjsonDone(JSON.stringify({ done: false })), false);
  assert.equal(isNdjsonDone("garbage"), false);
});

test("streams a think:false completion and strips fences", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const engine = new OllamaCompletionEngine({
    url: "https://ollama.com/api/chat",
    apiKey: "test-key",
    timeoutMs: 1_000,
    fetcher: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return ndjsonResponse([
        JSON.stringify({ message: { content: "```python\n" } }),
        JSON.stringify({ message: { content: "    out.append(x)" } }),
        JSON.stringify({ message: { content: "\n```" }, done: true }),
      ]);
    },
  });
  const result = await engine.complete(
    { prefix: "p", suffix: "s", modelId: "gemma4:31b", maxTokens: 128 },
    new AbortController().signal,
  );
  assert.equal(result.text, "    out.append(x)");
  const body = JSON.parse(String(requests[0]?.init.body)) as {
    model: string;
    messages: Array<{ role: string; content: string }>;
    think: boolean;
    stream: boolean;
    options: { num_predict: number; temperature: number };
  };
  assert.equal(requests[0]?.url, "https://ollama.com/api/chat");
  assert.equal(body.model, "gemma4:31b");
  assert.equal(body.think, false);
  assert.equal(body.stream, true);
  assert.equal(body.options.num_predict, 128);
  assert.equal(body.options.temperature, 0);
  assert.equal(body.messages.length, 1);
  const headers = requests[0]?.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer test-key");
  assert.equal(headers.Accept, "application/x-ndjson");
});

test("never echoes upstream error bodies", async () => {
  const engine = new OllamaCompletionEngine({
    url: "https://ollama.com/api/chat",
    apiKey: "test-key",
    timeoutMs: 1_000,
    fetcher: async () => new Response('{"error":"prompt context leak"}', { status: 401 }),
  });
  await assert.rejects(
    engine.complete({ prefix: "p", suffix: "s", modelId: "gemma4:31b", maxTokens: 8 }, new AbortController().signal),
    (error: unknown) => error instanceof Error && error.message === "Ollama Cloud completion request failed (401)",
  );
});

test("aborted caller signal surfaces as a quiet no-result", async () => {
  const controller = new AbortController();
  const engine = new OllamaCompletionEngine({
    url: "https://ollama.com/api/chat",
    apiKey: "test-key",
    timeoutMs: 1_000,
    fetcher: async (_url, init) => {
      controller.abort();
      assert.equal((init?.signal as AbortSignal).aborted, true);
      throw new DOMException("aborted", "AbortError");
    },
  });
  const result = await engine.complete(
    { prefix: "p", suffix: "s", modelId: "gemma4:31b", maxTokens: 8 },
    controller.signal,
  );
  assert.equal(result.text, undefined);
});

test("times out long requests via the request timeout", async () => {
  const engine = new OllamaCompletionEngine({
    url: "https://ollama.com/api/chat",
    apiKey: "test-key",
    timeoutMs: 30,
    fetcher: (async (_url: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      await new Promise((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("hang resolved")), 250);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "TimeoutError"));
        });
      });
      return ndjsonResponse([]);
    }) as typeof fetch,
  });
  await assert.rejects(
    engine.complete({ prefix: "p", suffix: "s", modelId: "gemma4:31b", maxTokens: 8 }, new AbortController().signal),
    /failed/,
  );
});