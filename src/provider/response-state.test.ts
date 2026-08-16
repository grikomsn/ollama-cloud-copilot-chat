import assert from "node:assert/strict";
import test from "node:test";
import {
  createResponseStreamState,
  observeResponseEvent,
  toolCallId,
  validateResponseCompletion,
} from "./response-state";

test("tracks thinking boundaries through visible output", () => {
  const state = createResponseStreamState("request");
  assert.equal(observeResponseEvent("model", { thinking: "reasoning" }, state).closeThinking, false);
  assert.equal(state.thinkingOpen, true);
  assert.equal(observeResponseEvent("model", { text: "answer" }, state).closeThinking, true);
  state.thinkingOpen = false;
  observeResponseEvent("model", { done: true, doneReason: "stop" }, state);
  assert.doesNotThrow(() => validateResponseCompletion("model", state, false));
});

test("rejects incomplete, thinking-only, and output-limited responses", () => {
  const incomplete = createResponseStreamState("incomplete");
  observeResponseEvent("model", { thinking: "reasoning" }, incomplete);
  assert.throws(
    () => validateResponseCompletion("model", incomplete, false),
    /stream ended before model reported completion/,
  );

  const thinkingOnly = createResponseStreamState("thinking-only");
  observeResponseEvent("model", { thinking: "reasoning" }, thinkingOnly);
  observeResponseEvent("model", { done: true, doneReason: "stop" }, thinkingOnly);
  assert.throws(
    () => validateResponseCompletion("model", thinkingOnly, false),
    /completed without returning an answer or tool call/,
  );

  const limited = createResponseStreamState("limited");
  assert.equal(
    observeResponseEvent("model", { done: true, doneReason: "length" }, limited).outputLimited,
    true,
  );
});

test("enforces required tools independently from visible text", () => {
  const textOnly = createResponseStreamState("text-only");
  observeResponseEvent("model", { text: "I will not call a tool" }, textOnly);
  observeResponseEvent("model", { done: true, doneReason: "stop" }, textOnly);
  assert.throws(
    () => validateResponseCompletion("model", textOnly, true),
    /completed without the required tool call/,
  );

  const withTool = createResponseStreamState("with-tool");
  observeResponseEvent("model", {
    toolCalls: [{ function: { name: "first", arguments: {} } }],
  }, withTool);
  observeResponseEvent("model", { done: true, doneReason: "stop" }, withTool);
  assert.doesNotThrow(() => validateResponseCompletion("model", withTool, true));
});

test("creates stable unique fallback IDs for parallel calls", () => {
  const state = createResponseStreamState("request-id");
  assert.equal(toolCallId("upstream", state), "upstream");
  assert.equal(toolCallId(undefined, state), "ollama-cloud-request-id-0");
  assert.equal(toolCallId(undefined, state), "ollama-cloud-request-id-1");
});

test("surfaces streamed API errors without accepting later content", () => {
  const state = createResponseStreamState("error");
  assert.throws(
    () => observeResponseEvent("model", { error: "backend failed" }, state),
    /backend failed/,
  );
  assert.equal(state.sawAnswer, false);
});
