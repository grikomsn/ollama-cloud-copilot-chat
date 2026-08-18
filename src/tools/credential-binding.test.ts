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
  const [bound] = bindCredentialToTools(tools, "sha256-ref");
  assert.deepEqual(bound.function.parameters.required, ["query", "credential_ref"]);
  assert.deepEqual(
    (bound.function.parameters.properties as Record<string, unknown>).credential_ref,
    { type: "string", enum: ["sha256-ref"] },
  );
});
