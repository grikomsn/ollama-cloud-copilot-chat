import assert from "node:assert/strict";
import test from "node:test";
import type { CloudModel } from "../models/catalog";
import { buildChatRequestPlan } from "./request";

const model: CloudModel = {
  id: "test-model",
  name: "Test",
  family: "test",
  version: "1",
  contextLength: 100,
  maxOutputTokens: 80,
  capabilities: { imageInput: true, toolCalling: true, thinking: true },
};

test("builds a bounded streaming request without mutating conversation history", () => {
  const messages = [{ role: "user" as const, content: "hello" }];
  const plan = buildChatRequestPlan(model, messages, [], "high", false, 20, 4);
  assert.deepEqual(messages, [{ role: "user", content: "hello" }]);
  assert.equal(plan.body.stream, true);
  assert.equal(plan.body.think, "high");
  assert.equal(plan.maxOutputTokens, 20);
  assert.equal(plan.requiresToolCall, false);
});

test("adds the required-tool instruction only when client tools are available", () => {
  const tool = { type: "function" as const, function: { name: "echo", parameters: {} } };
  const plan = buildChatRequestPlan(
    model,
    [{ role: "user", content: "use a tool" }],
    [tool],
    undefined,
    true,
    80,
    4,
  );
  assert.equal(plan.requiresToolCall, true);
  assert.equal(plan.body.messages[0].role, "system");
  assert.deepEqual(plan.body.tools, [tool]);
  assert.ok(plan.maxOutputTokens < model.contextLength);
});
