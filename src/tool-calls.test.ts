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

test("keeps indexed calls separate when fragments arrive in separate events", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.add([{ index: 0, function: { name: "read", arguments: { path: "a" } } }]);
  accumulator.add([{ index: 1, function: { name: "read", arguments: { path: "b" } } }]);

  assert.deepEqual(accumulator.finish().calls.map((call) => call.function.arguments), [
    { path: "a" },
    { path: "b" },
  ]);
});

test("keeps parallel anonymous fragments separate by array slot", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.add([
    { function: { name: "read", arguments: '{"path"' } },
    { function: { name: "read", arguments: '{"path"' } },
  ]);
  accumulator.add([
    { function: { arguments: ':"a"}' } },
    { function: { arguments: ':"b"}' } },
  ]);

  assert.deepEqual(accumulator.finish().calls.map((call) => call.function.arguments), [
    { path: "a" },
    { path: "b" },
  ]);
});

test("upgrades an anonymous slot when a later fragment supplies identity", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.add([{ function: { name: "read", arguments: '{"path"' } }]);
  accumulator.add([{ id: "call-1", index: 0, function: { arguments: ':"README.md"}' } }]);

  assert.deepEqual(accumulator.finish().calls, [{
    id: "call-1",
    index: 0,
    function: { name: "read", arguments: { path: "README.md" } },
  }]);
});

test("rejects conflicting unkeyed fragments instead of merging them", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.add([{ function: { name: "read", arguments: { path: "a" } } }]);
  accumulator.add([{ function: { name: "write", arguments: { path: "b" } } }]);

  assert.deepEqual(accumulator.finish(), {
    calls: [],
    error: "Ollama Cloud returned ambiguous unkeyed tool call fragments",
  });
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
