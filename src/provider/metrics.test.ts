import assert from "node:assert/strict";
import test from "node:test";
import { ollamaPromptMetrics } from "./metrics";

test("counts serialized message, tool, and framing characters", () => {
  const metrics = ollamaPromptMetrics(
    [{
      role: "assistant",
      content: "answer",
      tool_calls: [{
        id: "call-1",
        type: "function",
        function: { index: 0, name: "lookup", arguments: { q: "value" } },
      }],
    }],
    [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
  );
  assert.ok(metrics.textChars > "answerlookupvalue".length);
  assert.equal(metrics.imageCount, 0);
});

test("counts images without including base64 bytes", () => {
  const short = ollamaPromptMetrics(
    [{ role: "user", content: "describe", images: ["a"] }],
    [],
  );
  const long = ollamaPromptMetrics(
    [{ role: "user", content: "describe", images: ["a".repeat(100_000)] }],
    [],
  );
  assert.deepEqual(long, short);
  assert.equal(short.imageCount, 1);
});
