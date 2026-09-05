import assert from "node:assert/strict";
import test from "node:test";
import { buildCompletionPrompt, stripCodeFence } from "./prompt";

test("emulates fill-in-the-middle with FIM tokens in one user message", () => {
  const prompt = buildCompletionPrompt("before", "after");
  assert.deepEqual(prompt.messages, [
    { role: "user", content: "<|fim_prefix|>before<|fim_suffix|>after<|fim_middle|>" },
  ]);
});

test("strips a single surrounding code fence", () => {
  assert.equal(stripCodeFence("```python\n    out.append(x)\n```"), "    out.append(x)");
  assert.equal(stripCodeFence("```\nplain\nfence\n```"), "plain\nfence");
});

test("leaves unfenced or inline-fenced text untouched", () => {
  assert.equal(stripCodeFence("    out.append(x)"), "    out.append(x)");
  assert.equal(stripCodeFence("use `x = 1` inline"), "use `x = 1` inline");
  assert.equal(stripCodeFence("```python\nonly-open"), "```python\nonly-open");
  const single = "```python\ncode";
  assert.equal(stripCodeFence(single), single);
  const inline = "```python\ncode\n```\nmore";
  assert.equal(stripCodeFence(inline), inline);
});