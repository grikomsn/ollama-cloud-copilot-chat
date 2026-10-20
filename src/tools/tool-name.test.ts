import assert from "node:assert/strict";
import test from "node:test";
import { declaredToolName } from "./tool-name";
const tools = [{ type: "function" as const, function: { name: "probe", description: "Synthetic probe", parameters: { type: "object" } } }];

test("maps GPT-OSS channel suffixes only to advertised tool names", () => {
  assert.equal(declaredToolName("probe", tools, true), "probe");
  assert.equal(declaredToolName("probe<|channel|>commentary", tools, true), "probe");
  assert.throws(() => declaredToolName("other<|channel|>commentary", tools, true), /not advertised/);
  assert.throws(() => declaredToolName("probe<|channel|>unexpected", tools, true), /not advertised/);
  assert.throws(() => declaredToolName("probe<|channel|>commentary", tools, false), /not advertised/);
});

test("repairs whitespace and the functions namespace against the exact advertised set", () => {
  assert.equal(declaredToolName(" probe\n", tools, false), "probe");
  assert.equal(declaredToolName("functions.probe", tools, false), "probe");
  assert.equal(declaredToolName(" functions.probe ", tools, false), "probe");
  assert.equal(declaredToolName("functions.probe<|channel|>analysis", tools, true), "probe");
  for (const name of ["functions.other", "tools.probe", "Functions.probe", "PROBE", "pro-be"]) {
    assert.throws(() => declaredToolName(name, tools, false), /not advertised/);
  }
});

test("prefers an exact namespaced tool over a repaired bare name", () => {
  const namespaced = { type: "function" as const, function: { name: "functions.probe", parameters: {} } };
  assert.equal(declaredToolName("functions.probe", [...tools, namespaced], false), "functions.probe");
});

test("reports structural diagnostics without echoing a rejected tool name", () => {
  assert.throws(() => declaredToolName("synthetic_private_tool_name", tools, false), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /nameLength=27, advertisedTools=1, namespace=none/);
    assert.doesNotMatch(error.message, /synthetic_private_tool_name/);
    return true;
  });
});
