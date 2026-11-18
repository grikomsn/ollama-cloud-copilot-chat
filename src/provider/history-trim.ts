/** Token estimation and oldest-turn trimming for opted-in context caps. */

import { dropOldestUnits, IMAGE_TOKEN_ESTIMATE, textTokens, unitStartsBy, type HistoryTrimResult as KitTrimResult } from "../kit/history-trim";
import type { OllamaMessage } from "./messages";

/** Result of trimming converted Ollama messages against a context cap. */
export type HistoryTrimResult = KitTrimResult<OllamaMessage>;

/**
 * Estimates the token weight of one converted Ollama message. Text and
 * thinking use the chars-per-token heuristic; images use a fixed estimate.
 */
export function estimateMessageTokens(message: OllamaMessage): number {
  let tokens = textTokens(message.content);
  if (typeof message.thinking === "string") tokens += textTokens(message.thinking);
  tokens += (message.images?.length ?? 0) * IMAGE_TOKEN_ESTIMATE;
  for (const call of message.tool_calls ?? []) {
    tokens += Math.max(1, textTokens(`${call.function.name}${JSON.stringify(call.function.arguments)}`));
  }
  return Math.max(1, tokens);
}

/**
 * Drops the oldest conversation turns from converted messages so the estimated
 * payload fits an opted-in context cap. Units are bounded by user messages
 * with no outstanding tool calls, so tool calls and results are never split,
 * and the first and current messages always survive.
 *
 * @example
 * ```ts
 * const result = trimHistoryToFit(convertedMessages, contextCapTokens);
 * ```
 */
export function trimHistoryToFit(messages: readonly OllamaMessage[], budgetTokens: number): HistoryTrimResult {
  // Ollama tool results carry a tool_name instead of a call id, so pending
  // calls are tracked as a multiset of names.
  const starts = unitStartsBy(messages, (message) => message.role === "user", (message, pending) => {
    for (const call of message.tool_calls ?? []) pending.open(call.function.name);
    if (message.role === "tool" && message.tool_name) pending.settle(message.tool_name);
  });
  return dropOldestUnits(messages, messages.map(estimateMessageTokens), starts, budgetTokens);
}

