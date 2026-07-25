import type { CloudModel } from "./catalog";

export type ThinkValue = boolean | "low" | "medium" | "high" | "max";

const GPT_OSS_LEVELS = ["low", "medium", "high"] as const;
const ALWAYS_THINKING_LEVELS = ["low", "medium", "high", "max"] as const;
const STANDARD_LEVELS = ["disabled", "low", "medium", "high", "max"] as const;

export function buildThinkingSchema(model: CloudModel): {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
} | undefined {
  if (!model.capabilities.thinking) return undefined;
  const gptOss = model.family === "gpt-oss";
  const alwaysThinking = gptOss || model.family === "minimax";
  const values = gptOss
    ? GPT_OSS_LEVELS
    : alwaysThinking ? ALWAYS_THINKING_LEVELS : STANDARD_LEVELS;
  return {
    type: "object",
    properties: {
      thinkingEffort: {
        type: "string",
        title: "Thinking Effort",
        enum: [...values],
        enumItemLabels: values.map(label),
        enumDescriptions: values.map(description),
        default: gptOss ? "medium" : "high",
        group: "navigation",
      },
    },
  };
}

export function resolveThinkValue(
  model: CloudModel,
  configuration: Readonly<Record<string, unknown>> | undefined,
): ThinkValue | undefined {
  if (!model.capabilities.thinking) return undefined;
  const value = configuration?.thinkingEffort;
  if (model.family === "gpt-oss") {
    return typeof value === "string" && GPT_OSS_LEVELS.includes(value as typeof GPT_OSS_LEVELS[number])
      ? value as typeof GPT_OSS_LEVELS[number]
      : "medium";
  }
  if (model.family === "minimax") {
    return typeof value === "string"
      && ALWAYS_THINKING_LEVELS.includes(value as typeof ALWAYS_THINKING_LEVELS[number])
      ? value as typeof ALWAYS_THINKING_LEVELS[number]
      : "high";
  }
  if (value === "disabled") return false;
  return typeof value === "string"
    && ["low", "medium", "high", "max"].includes(value)
    ? value as "low" | "medium" | "high" | "max"
    : "high";
}

function label(value: string): string {
  return value === "disabled" ? "Off" : value.charAt(0).toUpperCase() + value.slice(1);
}

function description(value: string): string {
  switch (value) {
    case "disabled": return "Disable the model's reasoning trace";
    case "low": return "Prefer faster responses with a shorter reasoning trace";
    case "medium": return "Balance response time and reasoning depth";
    case "high": return "Use deeper reasoning for complex work";
    case "max": return "Request the model's highest available thinking level";
    default: return value;
  }
}
