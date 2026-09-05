/**
 * Configuration surface for experimental inline code suggestions.
 *
 * Suggestions are strictly opt-in: `ollamaCloudCopilot.inlineSuggestions`
 * defaults to false and the provider checks the setting live on every
 * request, so toggling needs no reload.
 */

export const CONFIG_SECTION = "ollamaCloudCopilot";

export const INLINE_SUGGESTIONS_SETTING = "inlineSuggestions";
export const INLINE_SUGGESTIONS_MODEL_SETTING = "inlineSuggestionsModel";
export const INLINE_SUGGESTIONS_CHAT_INPUT_SETTING = "inlineSuggestionsChatInput";
export const INLINE_DEBOUNCE_MS_SETTING = "inlineSuggestionsDebounceMs";
export const INLINE_TIMEOUT_MS_SETTING = "inlineSuggestionsTimeoutMs";
export const INLINE_MAX_TOKENS_SETTING = "inlineSuggestionsMaxTokens";
export const INLINE_PREFIX_LINES_SETTING = "inlineSuggestionsPrefixLines";
export const INLINE_SUFFIX_CHARS_SETTING = "inlineSuggestionsSuffixChars";

/** Live-measured zero-reasoning default (751ms total, think: false). */
export const DEFAULT_INLINE_MODEL = "gemma4:31b";
export const DEFAULT_INLINE_DEBOUNCE_MS = 300;
export const DEFAULT_INLINE_TIMEOUT_MS = 3_000;
export const DEFAULT_INLINE_MAX_TOKENS = 128;
export const DEFAULT_INLINE_PREFIX_LINES = 10;
export const DEFAULT_INLINE_SUFFIX_CHARS = 300;
export const DEFAULT_INLINE_SUGGESTIONS_CHAT_INPUT = false;

export function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}