import assert from "node:assert/strict";
import test from "node:test";
import { estimateMessageTokens, trimHistoryToFit } from "./history-trim";
import type { OllamaMessage } from "./messages";

function userMessage(text: string): OllamaMessage {
  return { role: "user", content: text };
}

function toolCallMessage(name: string): OllamaMessage {
  return {
    role: "assistant",
    content: "",
    tool_calls: [{ type: "function", function: { index: 0, name, arguments: {} } }],
  };
}

function toolResultMessage(name: string, content: string): OllamaMessage {
  return { role: "tool", content, tool_name: name };
}

test("keeps history that already fits the budget", () => {
  const messages = [userMessage("hello"), userMessage("more")];
  const result = trimHistoryToFit(messages, 10_000);

  assert.equal(result.removedItems, 0);
  assert.equal(result.items, messages);
});

test("drops the oldest turns until the estimated payload fits", () => {
  const messages = [
    userMessage("a".repeat(400)),
    userMessage("b".repeat(400)),
    userMessage("c".repeat(400)),
    userMessage("d".repeat(400)),
    userMessage("e".repeat(400)),
  ];
  const result = trimHistoryToFit(messages, 250);

  assert.equal(result.removedItems, 3);
  assert.deepEqual(result.items, [messages[0], messages[4]]);
  assert.ok(result.estimatedTokens <= 250);
});

test("keeps tool calls and their results in one dropped unit", () => {
  const messages = [
    userMessage("a".repeat(400)),
    userMessage("b".repeat(400)),
    toolCallMessage("run"),
    toolResultMessage("run", "done"),
    userMessage("c".repeat(400)),
    userMessage("d".repeat(400)),
  ];
  const result = trimHistoryToFit(messages, 310);

  assert.equal(result.removedItems, 3);
  assert.deepEqual(result.items, [messages[0], messages[4], messages[5]]);
});

test("does not split a pending tool call from its result", () => {
  const messages = [
    userMessage("a".repeat(400)),
    userMessage("b".repeat(400)),
    toolCallMessage("run"),
    userMessage("please continue"),
    toolResultMessage("run", "done"),
    userMessage("c".repeat(400)),
    userMessage("d".repeat(400)),
  ];
  const result = trimHistoryToFit(messages, 310);

  // The interleaved user text cannot become a drop boundary while the call is
  // unanswered, so the unit keeps the call, text, and result together.
  assert.equal(result.removedItems, 4);
  assert.deepEqual(result.items, [messages[0], messages[5], messages[6]]);
});

test("keeps the anchor and current turn when nothing else fits", () => {
  const messages = [
    userMessage("anchor"),
    userMessage("x".repeat(4000)),
    userMessage("current"),
  ];
  const result = trimHistoryToFit(messages, 10);

  assert.equal(result.removedItems, 1);
  assert.deepEqual(result.items, [messages[0], messages[2]]);
});

test("never trims single-message history", () => {
  assert.equal(trimHistoryToFit([], 100).removedItems, 0);
  assert.equal(trimHistoryToFit([userMessage("only turn ".repeat(100))], 1).removedItems, 0);
});

test("ignores budgets that are zero or negative", () => {
  const messages = [userMessage("a"), userMessage("b"), userMessage("c")];
  const result = trimHistoryToFit(messages, 0);

  assert.equal(result.removedItems, 0);
  assert.equal(result.items, messages);
});

test("estimates images, thinking, and tool calls with fixed weights", () => {
  assert.equal(estimateMessageTokens(userMessage("x".repeat(40))), 10);
  assert.equal(estimateMessageTokens({ role: "user", content: "", images: ["AAAA", "BBBB"] }), 2 * 1024);
  assert.equal(estimateMessageTokens({ role: "assistant", content: "", thinking: "x".repeat(40) }), 10);
  assert.equal(estimateMessageTokens(toolCallMessage("run")), Math.ceil("run{}".length / 4));
  assert.equal(estimateMessageTokens(toolResultMessage("run", "ok")), 1);
});
