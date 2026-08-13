import assert from "node:assert/strict";
import test from "node:test";
import { ToolCallAccumulator } from "./tool-calls";

test("assembles fragmented arguments into one native tool call", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.add([{
    id: "call-1",
    index: 0,
    function: { name: "read", arguments: '{"path"' },
  }]);
  accumulator.add([{
    id: "call-1",
    index: 0,
    function: { arguments: ':"README.md"}' },
  }]);

  assert.deepEqual(accumulator.finish(), {
    calls: [{
      id: "call-1",
      index: 0,
      function: { name: "read", arguments: { path: "README.md" } },
    }],
  });
});

test("keeps parallel indexed calls separate", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.add([
    { index: 0, function: { name: "read", arguments: { path: "a" } } },
    { index: 1, function: { name: "read", arguments: { path: "b" } } },
  ]);

  assert.deepEqual(accumulator.finish().calls.map((call) => call.function.arguments), [
    { path: "a" },
    { path: "b" },
  ]);
});

test("joins anonymous metadata and argument fragments when no key is supplied", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.add([{ function: { name: "read" } }]);
  accumulator.add([{ function: { arguments: { path: "README.md" } } }]);

  assert.deepEqual(accumulator.finish().calls, [{
    function: { name: "read", arguments: { path: "README.md" } },
  }]);
});

test("reports incomplete arguments only when the stream is finalized", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.add([{ function: { name: "read", arguments: "{broken" } }]);

  assert.deepEqual(accumulator.finish(), {
    calls: [],
    error: "Ollama Cloud returned invalid arguments for tool read",
  });
});
