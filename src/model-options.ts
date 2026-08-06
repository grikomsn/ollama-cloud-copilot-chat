import type { CloudModel } from "./catalog";

export type ThinkValue = boolean | "low" | "medium" | "high" | "max";

const GPT_OSS_LEVELS = ["low", "medium", "high"] as const;
const BOOLEAN_VALUES = ["disabled", "enabled"] as const;
const BOOLEAN_THINKING_MODELS = new Set([
  "deepseek-v4-flash:0731",
  "deepseek-v4-flash:preview",
  "deepseek-v4-pro",
  "gemma4:31b",
  "glm-5.1",
  "glm-5.2",
  "kimi-k2.6",
  "kimi-k2.7-code",
  "nemotron-3-nano:30b",
  "nemotron-3-super",
  "nemotron-3-ultra",
  "qwen3.5:397b",
]);
const GPT_OSS_MODELS = new Set([
  "gpt-oss:20b",
  "gpt-oss:120b",
]);

export function buildThinkingSchema(model: CloudModel): {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
} | undefined {
  if (!model.capabilities.thinking) return undefined;
  const gptOss = GPT_OSS_MODELS.has(model.id);
  const booleanControl = BOOLEAN_THINKING_MODELS.has(model.id);
  if (!gptOss && !booleanControl) return undefined;
  const values = gptOss ? GPT_OSS_LEVELS : BOOLEAN_VALUES;
  return {
    type: "object",
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
  if (GPT_OSS_MODELS.has(model.id)) {
    return typeof value === "string" && GPT_OSS_LEVELS.includes(value as typeof GPT_OSS_LEVELS[number])
      ? value as typeof GPT_OSS_LEVELS[number]
      : "medium";
  }
  if (!BOOLEAN_THINKING_MODELS.has(model.id)) return undefined;
  if (value === "disabled") return false;
  return true;
}

function label(value: string): string {
  if (value === "disabled") return "Off";
  if (value === "enabled") return "On";
  return value.charAt(0).toUpperCase() + value.slice(1);
}
