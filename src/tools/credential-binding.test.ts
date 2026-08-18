import assert from "node:assert/strict";
import test from "node:test";
import type { OllamaTool } from "../provider/messages";
import { bindCredentialToTools } from "./credential-binding";

test("binds Ollama web search to the selected model credential", () => {
  const tools: OllamaTool[] = [{
    type: "function",
    function: {
      name: "ollama-cloud_web-search",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  }];
  const bound = bindCredentialToTools(tools, "capability-a");
  assert.equal(bound.tools[0].function.name, "ollama-cloud_web-search__capability_a");
  assert.deepEqual(
    bound.routeToolCall("ollama-cloud_web-search__capability_a", {
      query: "news",
      credential_capability: "capability-b",
    }),
    {
      name: "ollama-cloud_web-search",
      input: { query: "news", credential_capability: "capability-a" },
    },
  );
  assert.throws(
    () => bound.routeToolCall("ollama-cloud_web-search__capability_b", { query: "news" }),
    /unbound web-search tool call/,
  );
  assert.deepEqual(bound.bindMessages([
    {
      role: "assistant",
      content: "",
      tool_calls: [{
        id: "call-1",
        type: "function",
        function: { index: 0, name: "ollama-cloud_web-search", arguments: { query: "news" } },
      }],
    },
    { role: "tool", content: "result", tool_name: "ollama-cloud_web-search" },
  ]), [
    {
      role: "assistant",
      content: "",
      tool_calls: [{
        id: "call-1",
        type: "function",
        function: { index: 0, name: "ollama-cloud_web-search__capability_a", arguments: { query: "news" } },
      }],
    },
    { role: "tool", content: "result", tool_name: "ollama-cloud_web-search__capability_a" },
  ]);
});
