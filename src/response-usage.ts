import type { OllamaStreamEvent, OllamaToolCall } from "./ndjson";
import { estimateInputTokens } from "./token-estimate";

export interface ResponseUsageState {
  promptTokens?: number;
  completionTokens?: number;
  generatedChars: number;
}

export interface ResolvedResponseUsage {
  promptTokens: number;
  completionTokens: number;
  promptEstimated: boolean;
  completionEstimated: boolean;
}

export function createResponseUsageState(): ResponseUsageState {
  return { generatedChars: 0 };
}

export function observeResponseUsage(
  event: OllamaStreamEvent,
  state: ResponseUsageState,
): void {
  if (event.promptTokens !== undefined) state.promptTokens = event.promptTokens;
  if (event.completionTokens !== undefined) state.completionTokens = event.completionTokens;
  state.generatedChars += event.text?.length ?? 0;
  state.generatedChars += event.thinking?.length ?? 0;
  state.generatedChars += (event.toolCalls ?? []).reduce(
    (total, tool) => total + toolCallChars(tool),
    0,
  );
}

export function resolveResponseUsage(
  state: Readonly<ResponseUsageState>,
  estimatedPromptTokens: number,
  charsPerToken: number,
): ResolvedResponseUsage {
  const promptEstimated = state.promptTokens === undefined
    || state.promptTokens === 0 && estimatedPromptTokens > 0;
  const completionEstimated = state.completionTokens === undefined
    || state.completionTokens === 0 && state.generatedChars > 0;
  return {
    promptTokens: promptEstimated
      ? Math.max(0, estimatedPromptTokens)
      : state.promptTokens ?? 0,
    completionTokens: completionEstimated
      ? estimateGeneratedTokens(state.generatedChars, charsPerToken)
      : state.completionTokens ?? 0,
    promptEstimated,
    completionEstimated,
  };
}

function estimateGeneratedTokens(generatedChars: number, charsPerToken: number): number {
  if (generatedChars <= 0) return 0;
  return Math.max(1, estimateInputTokens(
    { textChars: generatedChars, imageCount: 0 },
    validCharsPerToken(charsPerToken),
  ));
}

function toolCallChars(tool: OllamaToolCall): number {
  return (tool.id?.length ?? 0)
    + tool.function.name.length
    + JSON.stringify(tool.function.arguments).length;
}

function validCharsPerToken(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 4;
}
