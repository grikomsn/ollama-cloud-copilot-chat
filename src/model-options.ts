import type { CloudModel } from "./catalog";

export type ThinkValue = boolean | "low" | "medium" | "high" | "max";

const GPT_OSS_LEVELS = ["low", "medium", "high"] as const;
const BOOLEAN_VALUES = ["disabled", "enabled"] as const;

export function buildThinkingSchema(model: CloudModel): {
  properties: Record<string, Record<string, unknown>>;
} | undefined {
  if (!model.capabilities.thinking) return undefined;
  const gptOss = model.family === "gpt-oss";
  const booleanControl = model.family === "qwen" || model.family === "deepseek";
  if (!gptOss && !booleanControl) return undefined;
  const values = gptOss ? GPT_OSS_LEVELS : BOOLEAN_VALUES;
  return {
    properties: {
      thinkingEffort: {
        type: "string",
        title: gptOss ? "Thinking Effort" : "Thinking",
        enum: [...values],
        enumItemLabels: values.map(label),
        description: gptOss
          ? "Choose how much reasoning the model performs"
          : "Enable or disable the model's reasoning trace",
        default: gptOss ? "medium" : "enabled",
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
  if (model.family !== "qwen" && model.family !== "deepseek") return undefined;
  if (value === "disabled") return false;
  return true;
}

function label(value: string): string {
  if (value === "disabled") return "Off";
  if (value === "enabled") return "On";
  return value.charAt(0).toUpperCase() + value.slice(1);
}
