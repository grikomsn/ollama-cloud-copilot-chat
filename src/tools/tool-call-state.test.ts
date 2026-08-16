import assert from "node:assert/strict";
import test from "node:test";
import { ToolCallAccumulator } from "./tool-call-state";

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

test("keeps parallel anonymous calls separate within one event", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.add([
    { function: { name: "read", arguments: { path: "a" } } },
    { function: { name: "read", arguments: { path: "b" } } },
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

test("upgrades a partially keyed call with its complementary identity", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.add([{ id: "call-1", function: { name: "read", arguments: '{"path"' } }]);
  accumulator.add([{ index: 0, function: { arguments: ':"README.md"}' } }]);

  assert.deepEqual(accumulator.finish().calls, [{
    id: "call-1",
    index: 0,
    function: { name: "read", arguments: { path: "README.md" } },
  }]);
});

test("rejects anonymous fragments after the first event", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.add([{ function: { name: "read", arguments: { path: "a" } } }]);
  accumulator.add([{ function: { name: "read", arguments: { path: "b" } } }]);

  assert.deepEqual(accumulator.finish(), {
    calls: [],
    error: "Ollama Cloud returned ambiguous unkeyed tool call fragments",
  });
});

test("rejects reduced-cardinality anonymous events", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.add([
    { function: { name: "read", arguments: { path: "a" } } },
    { function: { name: "read", arguments: { path: "b" } } },
  ]);
  accumulator.add([{ function: { name: "read", arguments: { path: "c" } } }]);

  assert.deepEqual(accumulator.finish(), {
    calls: [],
    error: "Ollama Cloud returned ambiguous unkeyed tool call fragments",
  });
});

test("rejects an ambiguous complementary identity", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.add([
    { id: "call-1", function: { name: "read", arguments: { path: "a" } } },
    { id: "call-2", function: { name: "read", arguments: { path: "b" } } },
  ]);
  accumulator.add([{ index: 0, function: { arguments: {} } }]);

  assert.deepEqual(accumulator.finish(), {
    calls: [],
    error: "Ollama Cloud returned ambiguous tool-call identities",
  });
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

test("rejects anonymous metadata and argument fragments across events", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.add([{ function: { name: "read" } }]);
  accumulator.add([{ function: { arguments: { path: "README.md" } } }]);

  assert.deepEqual(accumulator.finish(), {
    calls: [],
    error: "Ollama Cloud returned ambiguous unkeyed tool call fragments",
  });
});

test("reports incomplete arguments only when the stream is finalized", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.add([{ function: { name: "read", arguments: "{broken" } }]);

  assert.deepEqual(accumulator.finish(), {
    calls: [],
    error: "Ollama Cloud returned invalid arguments for tool read",
  });
});
