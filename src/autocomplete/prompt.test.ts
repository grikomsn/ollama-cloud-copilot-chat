import assert from "node:assert/strict";
import test from "node:test";
import { cleanSuggestion } from "../kit/autocomplete/postprocess";
import { buildCompletionPrompt } from "./prompt";

test("emulates fill-in-the-middle with FIM tokens in one user message", () => {
  const prompt = buildCompletionPrompt("before", "after");
  assert.deepEqual(prompt.messages, [
    { role: "user", content: "<|fim_prefix|>before<|fim_suffix|>after<|fim_middle|>" },
  ]);
});

test("cleans suggestions the way the engine does, including leading blank lines", () => {
  assert.equal(cleanSuggestion("\n\n    out.append(x)", { trimLeadingNewlines: true }), "    out.append(x)");
  assert.equal(cleanSuggestion("<|file_separator|>```python\n    out.append(x)\n```", { trimLeadingNewlines: true }), "    out.append(x)");
});
