/** Token estimation and oldest-turn trimming for opted-in context caps. */

import type { OllamaMessage } from "./messages";

/** Result of trimming a request message list against a context cap. */
export interface HistoryTrimResult {
  readonly items: readonly OllamaMessage[];
  readonly removedItems: number;
  readonly estimatedTokens: number;
}

/** Fixed estimate per image, whose base64 payload is not token-shaped. */
const IMAGE_TOKEN_ESTIMATE = 1024;
/** Matches the extension's chars-per-token counting heuristic. */
const CHARS_PER_TOKEN = 4;

interface ItemUnit {
  readonly start: number;
  readonly end: number;
  readonly tokens: number;
}

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
  const itemTokens = messages.map((message) => estimateMessageTokens(message));
  const units = buildItemUnits(messages, itemTokens);
  const total = units.reduce((sum, unit) => sum + unit.tokens, 0);
  if (budgetTokens <= 0 || units.length < 3 || total <= budgetTokens) {
    return { items: messages, removedItems: 0, estimatedTokens: total };
  }
  // Drop the smallest prefix of middle units that fits, keeping the newest history.
  let droppedTokens = 0;
  let dropUpToUnit = 1;
  for (let unit = 1; unit <= units.length - 2; unit++) {
    droppedTokens += units[unit].tokens;
    dropUpToUnit = unit;
    if (total - droppedTokens <= budgetTokens) break;
  }
  const dropStart = units[1].start;
  const dropEnd = units[dropUpToUnit].end;
  return {
    items: [...messages.slice(0, dropStart), ...messages.slice(dropEnd + 1)],
    removedItems: dropEnd - dropStart + 1,
    estimatedTokens: total - droppedTokens,
  };
}

/** Groups messages into turn units bounded by user messages with settled tool calls. */
function buildItemUnits(messages: readonly OllamaMessage[], itemTokens: readonly number[]): ItemUnit[] {
  const units: ItemUnit[] = [];
  let start = 0;
  // Ollama tool results carry a tool_name instead of a call id, so pending
  // calls are tracked as a multiset of names.
  const pendingNames: string[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    const boundary = index > start && pendingNames.length === 0 && message.role === "user";
    if (boundary) {
      units.push({
        start,
        end: index - 1,
        tokens: itemTokens.slice(start, index).reduce((sum, tokens) => sum + tokens, 0),
      });
      start = index;
    }
    for (const call of message.tool_calls ?? []) pendingNames.push(call.function.name);
    if (message.role === "tool" && message.tool_name) {
      const settled = pendingNames.indexOf(message.tool_name);
      if (settled >= 0) pendingNames.splice(settled, 1);
    }
  }
  units.push({
    start,
    end: messages.length - 1,
    tokens: itemTokens.slice(start).reduce((sum, tokens) => sum + tokens, 0),
  });
  return units;
}

function textTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
