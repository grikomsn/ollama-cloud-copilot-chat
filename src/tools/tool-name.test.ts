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
