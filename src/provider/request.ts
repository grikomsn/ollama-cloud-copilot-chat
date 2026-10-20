import type { CloudModel } from "../models/catalog";
import type { ThinkValue } from "../models/options";
import { ollamaPromptMetrics } from "./metrics";
import { estimateInputTokens } from "./token-estimate";
import type { OllamaMessage, OllamaTool } from "./messages";

const REQUIRED_TOOL_INSTRUCTION = "You must call at least one of the provided tools before answering. Do not answer directly.";
const TOOL_NAME_INSTRUCTION = "Call only tools listed for this request, using their exact names. Tools mentioned in earlier turns may be unavailable.";

export interface ChatRequestPlan {
  readonly body: {
    readonly model: string;
    readonly messages: readonly OllamaMessage[];
    readonly stream: true;
    readonly tools?: readonly OllamaTool[];
    readonly think?: ThinkValue;
    readonly options: { readonly num_predict: number };
  };
  readonly calibrationChars: number;
  readonly estimatedInputTokens: number;
  readonly maxOutputTokens: number;
  readonly requiresToolCall: boolean;
}

export function buildChatRequestPlan(
  model: CloudModel,
  messages: readonly OllamaMessage[],
  tools: readonly OllamaTool[],
  think: ThinkValue | undefined,
  toolRequired: boolean,
  configuredMaxOutputTokens: number,
  charsPerToken: number,
): ChatRequestPlan {
  const requestMessages = [...messages];
  const requiresToolCall = tools.length > 0 && toolRequired;
  if (tools.length) {
    requestMessages.unshift({
      role: "system",
      content: requiresToolCall ? `${TOOL_NAME_INSTRUCTION}\n${REQUIRED_TOOL_INSTRUCTION}` : TOOL_NAME_INSTRUCTION,
    });
  }
  const promptMetrics = ollamaPromptMetrics(requestMessages, tools);
  const calibrationChars = promptMetrics.imageCount === 0 ? promptMetrics.textChars : 0;
  const estimatedInputTokens = Math.max(1, estimateInputTokens(promptMetrics, charsPerToken));
  if (estimatedInputTokens >= model.contextLength) {
    throw new Error(`${model.id} input exceeds its context window. Run /compact in Copilot Chat, reduce attachments or tool output, or start a new chat.`);
  }
  const remainingContextTokens = model.contextLength - estimatedInputTokens;
  const maxOutputTokens = Math.min(
    model.maxOutputTokens,
    remainingContextTokens,
    Math.max(1, configuredMaxOutputTokens),
  );
  return {
    body: {
      model: model.id,
      messages: requestMessages,
      stream: true,
      ...(tools.length ? { tools } : {}),
      ...(think === undefined ? {} : { think }),
      options: { num_predict: maxOutputTokens },
    },
    calibrationChars,
    estimatedInputTokens,
    maxOutputTokens,
    requiresToolCall,
  };
}
