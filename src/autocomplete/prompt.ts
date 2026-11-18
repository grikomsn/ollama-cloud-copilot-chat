/**
 * Prompt construction for the native Ollama chat completion engine.
 *
 * Ollama Cloud's `/api/chat` has no FIM endpoint, so fill-in-the-middle is
 * emulated with FIM delimiter tokens in a single user message and thinking is
 * disabled with the native `think: false` request field (live-measured zero
 * reasoning on gemma4:31b and glm-5.2). The measured payload sends no system
 * message: narration-prone models are excluded by documentation instead.
 *
 * Pure and unit-tested.
 */

import { fimUserContent } from "../kit/autocomplete/postprocess";

export interface CompletionPrompt {
  readonly messages: ReadonlyArray<{ role: string; content: string }>;
}

export function buildCompletionPrompt(prefix: string, suffix: string): CompletionPrompt {
  return {
    messages: [
      { role: "user", content: fimUserContent(prefix, suffix) },
    ],
  };
}
