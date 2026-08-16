import assert from "node:assert/strict";
import test from "node:test";
import { NdjsonStreamParser } from "./ndjson";

test("parses fragmented text, thinking, accumulated tools, and final usage", () => {
  const parser = new NdjsonStreamParser();
  assert.deepEqual(parser.push('{"message":{"thinking":"let'), []);
  assert.deepEqual(parser.push(' me"},"done":false}\n{"message":{"content":"answer"},"done":false}\n'), [
    { thinking: "let me" },
    { text: "answer" },
  ]);
  assert.deepEqual(parser.push('{"message":{"tool_calls":[{"function":{"name":"read","arguments":{"path":"x"}}}]},"done":false}\n'), []);
  assert.deepEqual(parser.push('{"done":true,"prompt_eval_count":11,"eval_count":7}\n'), [{
    promptTokens: 11,
    completionTokens: 7,
    toolCalls: [{
      function: { name: "read", arguments: { path: "x" } },
    }],
    done: true,
  }]);
});

test("surfaces malformed lines and continues parsing later events", () => {
  const parser = new NdjsonStreamParser();
  assert.deepEqual(parser.push("not json\n\n{\"message\":{\"content\":\"ok\"}}\n"), [
    { error: "Ollama Cloud returned malformed NDJSON" },
    { text: "ok" },
  ]);
});

test("preserves terminal done reasons", () => {
  const parser = new NdjsonStreamParser();
  assert.deepEqual(parser.push('{"done":true,"done_reason":"length"}\n'), [{
    done: true,
    doneReason: "length",
  }]);
});

test("accepts a final line without a newline", () => {
  const parser = new NdjsonStreamParser();
  parser.push('{"message":{"content":"tail"}}');
  assert.deepEqual(parser.finish(), [{ text: "tail" }]);
});

test("accumulates string tool arguments and surfaces streamed API errors", () => {
  const parser = new NdjsonStreamParser();
  assert.deepEqual(parser.push(
    "{\"message\":{\"tool_calls\":[{\"id\":\"call-1\",\"function\":{\"name\":\"read\",\"arguments\":\"{\\\"path\\\"\"}}]}}\n"
      + "{\"message\":{\"tool_calls\":[{\"id\":\"call-1\",\"function\":{\"arguments\":\":\\\"x\\\"}\"}}]},\"done\":false}\n"
      + "{\"error\":\"model retired\"}\n",
  ), [
    { error: "model retired" },
  ]);
});

test("flushes a fragmented string tool call with the completed response", () => {
  const parser = new NdjsonStreamParser();
  assert.deepEqual(parser.push(
    "{\"message\":{\"tool_calls\":[{\"id\":\"call-1\",\"function\":{\"name\":\"read\",\"arguments\":\"{\\\"path\\\"\"}}]}}\n"
      + "{\"message\":{\"tool_calls\":[{\"id\":\"call-1\",\"function\":{\"arguments\":\":\\\"x\\\"}\"}}]},\"done\":false}\n"
      + "{\"done\":true}\n",
  ), [{
    toolCalls: [{
      id: "call-1",
      function: { name: "read", arguments: { path: "x" } },
    }],
    done: true,
  }]);
});

test("rejects invalid tool arguments when the stream completes", () => {
  const parser = new NdjsonStreamParser();
  assert.deepEqual(parser.push(
    '{"message":{"tool_calls":[{"function":{"name":"read","arguments":"{broken"}}]}}\n'
      + '{"done":true}\n',
  ), [{ error: "Ollama Cloud returned invalid arguments for tool read", done: true }]);
});
