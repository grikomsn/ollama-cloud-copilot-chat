import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import type { CloudModel } from "../models/catalog";
import { createResponseStreamState } from "./response-state";
import { createResponseUsageState } from "./response-usage";

class TextPart { constructor(readonly value: string) {} }
class ThinkingPart { constructor(readonly value: string | string[]) {} }
class CallPart { constructor(readonly callId: string, readonly name: string, readonly input: unknown) {} }
const api = { LanguageModelTextPart: TextPart, LanguageModelThinkingPart: ThinkingPart, LanguageModelToolCallPart: CallPart };
const exported = {};
const nodeRequire = createRequire(__filename);
runInNewContext(readFileSync(join(__dirname, "response.js"), "utf8"), {
  exports: exported,
  require: (name: string) => name === "vscode" ? api : nodeRequire(name),
});
const { reportResponseEvent } = exported as typeof import("./response");
const model: CloudModel = {
  id: "synthetic", name: "Synthetic", family: "synthetic", version: "1", contextLength: 10000,
  maxOutputTokens: 1000, capabilities: { imageInput: false, toolCalling: true, thinking: false },
};

test("rejects a mixed tool batch before forwarding any calls or event text", () => {
  const output: unknown[] = [];
  assert.throws(() => reportResponseEvent(model, {
    text: "synthetic text",
    toolCalls: [
      { id: "a", function: { name: "allowed", arguments: {} } },
      { id: "b", function: { name: "unknown", arguments: {} } },
    ],
  }, { report: (part) => output.push(part) }, createResponseStreamState("request"), createResponseUsageState(), undefined,
  (name, input) => {
    if (name !== "allowed") throw new Error("not advertised");
    return { name, input };
  }), /not advertised/);
  assert.equal(output.length, 0);
});

test("forwards a validated batch in order with routed names, inputs, and original call IDs", () => {
  const output: unknown[] = [];
  reportResponseEvent(model, {
    toolCalls: [
      { id: "a", function: { name: "functions.first", arguments: { value: 1 } } },
      { id: "b", function: { name: "functions.second", arguments: { value: 2 } } },
    ],
  }, { report: (part) => output.push(part) }, createResponseStreamState("request"), createResponseUsageState(), undefined,
  (name, input) => ({ name: name.slice("functions.".length), input: { ...input, bound: true } }));
  assert.deepEqual(output, [
    new CallPart("a", "first", { value: 1, bound: true }),
    new CallPart("b", "second", { value: 2, bound: true }),
  ]);
});
