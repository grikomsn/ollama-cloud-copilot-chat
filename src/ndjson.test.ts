import assert from "node:assert/strict";
import test from "node:test";
import { NdjsonStreamParser } from "./ndjson";

test("parses fragmented text, thinking, tools, and final usage", () => {
  const parser = new NdjsonStreamParser();
  assert.deepEqual(parser.push('{"message":{"thinking":"let'), []);
  assert.deepEqual(parser.push(' me"},"done":false}\n{"message":{"content":"answer"},"done":false}\n'), [
    { thinking: "let me" },
    { text: "answer" },
  ]);
  assert.deepEqual(parser.push('{"message":{"tool_calls":[{"function":{"name":"read","arguments":{"path":"x"}}}]},"done":false}\n'), [
    {
      toolCalls: [{
        function: { name: "read", arguments: { path: "x" } },
      }],
    },
  ]);
  assert.deepEqual(parser.push('{"done":true,"prompt_eval_count":11,"eval_count":7}'), []);
  assert.deepEqual(parser.finish(), [{
    promptTokens: 11,
    completionTokens: 7,
    done: true,
  }]);
});

test("ignores malformed lines and continues", () => {
  const parser = new NdjsonStreamParser();
  assert.deepEqual(parser.push("not json\n\n{\"message\":{\"content\":\"ok\"}}\n"), [{ text: "ok" }]);
});

test("accepts a final line without a newline", () => {
  const parser = new NdjsonStreamParser();
  parser.push('{"message":{"content":"tail"}}');
  assert.deepEqual(parser.finish(), [{ text: "tail" }]);
});

test("surfaces streamed API errors and string tool arguments", () => {
  const parser = new NdjsonStreamParser();
  assert.deepEqual(parser.push(
    "{\"message\":{\"tool_calls\":[{\"function\":{\"name\":\"read\",\"arguments\":\"{\\\"path\\\":\\\"x\\\"}\"}}]}}\n"
      + "{\"error\":\"model retired\"}\n",
  ), [
    {
      toolCalls: [{
        function: { name: "read", arguments: { path: "x" } },
      }],
    },
    { error: "model retired" },
  ]);
});
