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

test("keeps an anonymous call separate when a later fragment supplies identity", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.add([{ function: { name: "read", arguments: { path: "a" } } }]);
  accumulator.add([{ id: "call-1", index: 0, function: {
    name: "read",
    arguments: { path: "b" },
  } }]);

  assert.deepEqual(accumulator.finish().calls, [
    { function: { name: "read", arguments: { path: "a" } } },
    { id: "call-1", index: 0, function: { name: "read", arguments: { path: "b" } } },
  ]);
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

test("assembles anonymous fragments for a singleton call across events", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.add([{ function: { name: "read", arguments: { path: "a" } } }]);
  accumulator.add([{ function: { arguments: { line: 4 } } }]);

  assert.deepEqual(accumulator.finish().calls, [{
    function: { name: "read", arguments: { path: "a", line: 4 } },
  }]);
});

test("rejects parallel anonymous fragments across events", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.add([
    { function: { name: "read", arguments: { path: "a" } } },
    { function: { name: "write", arguments: { path: "b" } } },
  ]);
  accumulator.add([
    { function: { arguments: { line: 4 } } },
    { function: { arguments: { line: 8 } } },
  ]);

  assert.deepEqual(accumulator.finish(), {
    calls: [],
    error: "Ollama Cloud returned ambiguous unkeyed tool call fragments",
  });
});

test("rejects an unkeyed continuation for a keyed call", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.add([{ id: "call-1", index: 0, function: {
    name: "read",
    arguments: { path: "a" },
  } }]);
  accumulator.add([{ function: { arguments: { line: 4 } } }]);

  assert.deepEqual(accumulator.finish(), {
    calls: [],
    error: "Ollama Cloud returned ambiguous unkeyed tool call fragments",
  });
});

test("matches mixed keyed and anonymous continuations independent of fragment order", () => {
  const keyed = { id: "call-2", index: 1, function: {
    arguments: { encoding: "utf-8" },
  } };
  const anonymous = { function: { arguments: { line: 4 } } };
  for (const fragments of [[keyed, anonymous], [anonymous, keyed]] as const) {
    const accumulator = new ToolCallAccumulator();
    accumulator.add([
      { function: { name: "read", arguments: { path: "a" } } },
      { id: "call-2", index: 1, function: {
        name: "write",
        arguments: { path: "b" },
      } },
    ]);
    accumulator.add(fragments);

    assert.deepEqual(accumulator.finish().calls, [
      { function: { name: "read", arguments: { path: "a", line: 4 } } },
      { id: "call-2", index: 1, function: {
        name: "write",
        arguments: { path: "b", encoding: "utf-8" },
      } },
    ]);
  }
});

test("rejects a keyed upgrade when multiple calls are pending", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.add([
    { function: { name: "read", arguments: { path: "a" } } },
    { id: "call-2", index: 1, function: {
      name: "read",
      arguments: { path: "b" },
    } },
  ]);
  accumulator.add([{ id: "call-1", index: 0, function: {
    arguments: { line: 4 },
  } }]);

  assert.deepEqual(accumulator.finish(), {
    calls: [],
    error: "Ollama Cloud returned ambiguous tool-call identities",
  });
});

test("rejects multiple new keyed calls after an anonymous call", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.add([{ function: { name: "read", arguments: { path: "a" } } }]);
  accumulator.add([
    { id: "call-2", index: 1, function: { name: "read", arguments: { path: "b" } } },
    { id: "call-3", index: 2, function: { name: "read", arguments: { path: "c" } } },
  ]);

  assert.deepEqual(accumulator.finish(), {
    calls: [],
    error: "Ollama Cloud returned ambiguous tool-call identities",
  });
});

test("does not merge complementary identities created in one event", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.add([
    { id: "call-1", function: { name: "read", arguments: { path: "a" } } },
    { index: 0, function: { name: "read", arguments: { path: "b" } } },
  ]);

  assert.deepEqual(accumulator.finish().calls, [
    { id: "call-1", function: { name: "read", arguments: { path: "a" } } },
    { index: 0, function: { name: "read", arguments: { path: "b" } } },
  ]);
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

test("merges anonymous metadata and argument fragments across events", () => {
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
