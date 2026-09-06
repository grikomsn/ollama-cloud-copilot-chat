import assert from "node:assert/strict";
import test from "node:test";
import { buildCompletionPrompt, stripCodeFence, stripSpecialTokens } from "./prompt";

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

test("strips a dangling opener left by a truncated stream", () => {
  assert.equal(stripCodeFence("```python\n(a - low) / (high - low) if high != low else 0.0"), "(a - low) / (high - low) if high != low else 0.0");
  assert.equal(stripCodeFence("```\n    out.append(x)"), "    out.append(x)");
});

test("strips an orphan closer without its opener", () => {
  assert.equal(stripCodeFence("    out.append(x)\n```"), "    out.append(x)");
});

test("drops leading newlines so ghost text does not start blank", () => {
  assert.equal(stripCodeFence("\n\n    out.append(x)"), "    out.append(x)");
  assert.equal(stripCodeFence("\n\n```python\n    out.append(x)\n```"), "    out.append(x)");
});

test("leaves unfenced or inline-fenced text untouched", () => {
  assert.equal(stripCodeFence("    out.append(x)"), "    out.append(x)");
  assert.equal(stripCodeFence("use `x = 1` inline"), "use `x = 1` inline");
  const inline = "```python\ncode\n```\nmore";
  assert.equal(stripCodeFence(inline), inline);
  // A nested fence inside a surrounding fence keeps the inner code.
  assert.equal(stripCodeFence("```python\n```js\nx\n```\n```"), "```js\nx\n```");
});

test("strips echoed special tokens from suggestions", () => {
  assert.equal(stripSpecialTokens("<|file_separator|>    out.append(x)"), "    out.append(x)");
  assert.equal(stripSpecialTokens("    out.append(x)<|fim_middle|>"), "    out.append(x)");
  assert.equal(stripSpecialTokens("<|fim_prefix|>a<|fim_suffix|>b<|fim_middle|>c"), "abc");
  assert.equal(stripSpecialTokens("    out.append(x)"), "    out.append(x)");
  assert.equal(stripSpecialTokens("echo <| b; # no closing pair"), "echo <| b; # no closing pair");
  assert.equal(stripSpecialTokens("<|file_separator|>"), "");
});

test("token stripping composes with fence stripping in engine order", () => {
  assert.equal(stripCodeFence(stripSpecialTokens("<|file_separator|>```python\n    out.append(x)\n```")), "    out.append(x)");
});
