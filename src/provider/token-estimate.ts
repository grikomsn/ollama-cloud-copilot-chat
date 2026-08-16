import type { MessageMetrics } from "./messages";

export const ESTIMATED_IMAGE_TOKENS = 1024;

export function estimateInputTokens(metrics: MessageMetrics, charsPerToken: number): number {
  return Math.ceil(metrics.textChars / charsPerToken)
    + metrics.imageCount * ESTIMATED_IMAGE_TOKENS;
}
