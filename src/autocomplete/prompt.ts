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
 * Strip code-fence artifacts from a suggestion. Live-measured gemma and glm
 * responses wrap the completion in a ```lang fence; ghost text must insert the
 * bare code. Three shapes are handled: a closed surrounding fence, a dangling
 * opener left when the token budget truncates the stream before the closing
 * fence, and an orphan closer. Leading newlines are dropped so ghost text does
 * not begin with a stray blank line. Responses that merely contain fences
 * inline are left untouched. Pure and unit-tested.
 */
export function stripCodeFence(text: string): string {
  const working = text.replace(/^\n+/, "").trimEnd();
  const closed = /^```[^\n]*\n([\s\S]*?)\n?[ \t]*```[ \t]*$/.exec(working);
  if (closed) return closed[1] ?? "";
  // Truncated before the closing fence: drop the dangling ```lang opener.
  const danglingOpener = /^```[^\n]*\n([\s\S]*)$/.exec(working);
  if (danglingOpener && !(danglingOpener[1] ?? "").includes("```")) return danglingOpener[1] ?? "";
  // Orphan closer without its opener.
  const orphanCloser = /^([\s\S]*?)\n[ \t]*```[ \t]*$/.exec(working);
  if (orphanCloser && !(orphanCloser[1] ?? "").includes("```")) return orphanCloser[1] ?? "";
  return working;
}
