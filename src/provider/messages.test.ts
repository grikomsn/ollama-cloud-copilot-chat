import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import type * as vscode from "vscode";

class TextPart {
  constructor(readonly value: string) {}
}
class DataPart {
  constructor(readonly data: Uint8Array, readonly mimeType: string) {}
}
class CallPart {
  constructor(readonly callId: string, readonly name: string, readonly input: unknown) {}
}
class ResultPart {
  constructor(readonly callId: string, readonly content: unknown[]) {}
}
class ThinkingPart {
  constructor(readonly value: string | string[]) {}
}

// Exercise the compiled converter with injected VS Code constructors, without an editor host.
const api = {
  LanguageModelTextPart: TextPart,
  LanguageModelDataPart: DataPart,
  LanguageModelToolCallPart: CallPart,
  LanguageModelToolResultPart: ResultPart,
  LanguageModelThinkingPart: ThinkingPart,
  LanguageModelChatMessageRole: { User: 1, Assistant: 2, System: 0 },
};
const exported = {};
runInNewContext(readFileSync(join(__dirname, "messages.js"), "utf8"), {
  exports: exported,
  require: (name: string) => { assert.equal(name, "vscode"); return api; },
  Buffer,
  TextDecoder,
});
const { convertMessages, messageMetrics } = exported as typeof import("./messages");

function message(role: number, content: unknown[]): vscode.LanguageModelChatRequestMessage {
  return { role, name: undefined, content } as vscode.LanguageModelChatRequestMessage;
}

test("keeps large tool-result images out of text and settles parallel calls before attaching images", () => {
  const bytes = new Uint8Array(1_000_000).fill(42);
  const messages = [
    message(2, [new CallPart("a", "capture", {}), new CallPart("b", "inspect", {})]),
    message(1, [
      new ResultPart("a", [new TextPart("screenshot"), new DataPart(bytes, "image/png")]),
      new ResultPart("b", [new TextPart("details"), new DataPart(bytes, "image/png")]),
      new TextPart("continue"),
    ]),
  ];
  const converted = convertMessages(messages);
  assert.equal(converted[1].role, "tool");
  assert.equal(converted[1].tool_name, "capture");
  assert.equal(converted[2].role, "tool");
  assert.equal(converted[2].tool_name, "inspect");
  assert.equal(converted[3].content, "continue");
  assert.equal(converted[4].role, "user");
  assert.equal(converted[4].images?.length, 2);
  assert.equal(converted[4].images?.[0], Buffer.from(bytes).toString("base64"));
  assert.ok(converted.reduce((total, item) => total + item.content.length, 0) < 300);
  const metrics = messageMetrics(messages[1]);
  assert.equal(metrics.imageCount, 2);
  assert.ok(metrics.textChars < 100);
});

test("uses a bounded placeholder for tool images on text-only models", () => {
  const converted = convertMessages([
    message(2, [new CallPart("a", "capture", {})]),
    message(1, [new ResultPart("a", [new DataPart(new Uint8Array(100_000), "image/png")])]),
  ], false);
  assert.equal(converted.length, 2);
  assert.match(converted[1].content, /omitted: model is text-only/);
  assert.ok(converted.every((item) => !item.images?.length));
});

test("defers images until parallel results in separate VS Code messages have all arrived", () => {
  const converted = convertMessages([
    message(2, [new CallPart("a", "capture", {}), new CallPart("b", "inspect", {})]),
    message(1, [new ResultPart("a", [new DataPart(new Uint8Array([1]), "image/png")])]),
    message(1, [new ResultPart("b", [new TextPart("details")])]),
  ]);
  assert.equal(converted.length, 4);
  assert.equal(converted[1].role, "tool");
  assert.equal(converted[2].role, "tool");
  assert.equal(converted[3].role, "user");
  assert.equal(converted[3].images?.[0], "AQ==");
});

test("preserves direct images, text data, and thinking", () => {
  const converted = convertMessages([
    message(1, [new DataPart(new Uint8Array([1, 2, 3]), "image/png"), new DataPart(new TextEncoder().encode("hello"), "text/plain")]),
    message(2, [new ThinkingPart(["reason", "more"]), new TextPart("answer")]),
  ]);
  assert.equal(converted[0].images?.[0], "AQID");
  assert.equal(converted[0].content, "hello");
  assert.equal(converted[1].thinking, "reason\nmore");
  assert.equal(converted[1].content, "answer");
});
