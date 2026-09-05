/**
 * Prompt construction for the native Ollama chat completion engine.
 *
 * Ollama Cloud's `/api/chat` has no FIM endpoint, so fill-in-the-middle is
 * emulated with FIM delimiter tokens in a single user message and thinking is
 * disabled with the native `think: false` request field (live-measured zero
 * reasoning on gemma4:31b and glm-5.1). The measured payload sends no system
 * message: narration-prone models are excluded by documentation instead.
 *
 * Pure and unit-tested.
 */

export interface CompletionPrompt {
  readonly messages: ReadonlyArray<{ role: string; content: string }>;
}

const FIM = { prefix: "<|fim_prefix|>", suffix: "<|fim_suffix|>", middle: "<|fim_middle|>" } as const;

export function buildCompletionPrompt(prefix: string, suffix: string): CompletionPrompt {
  return {
    messages: [
      { role: "user", content: `${FIM.prefix}${prefix}${FIM.suffix}${suffix}${FIM.middle}` },
    ],
  };
}

/**
 * Strip a single surrounding code fence from a suggestion. Live-measured gemma
 * responses wrap the completion in a ```lang fence; ghost text must insert the
 * bare code. Responses that merely contain fences inline are left untouched.
 * Pure and unit-tested.
 */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return text;
  const lines = trimmed.split("\n");
  if (lines.length < 2) return text;
  if (!lines[lines.length - 1]?.trim().startsWith("```")) return text;
  return lines.slice(1, -1).join("\n");
}