import type { CloudModel } from "./catalog";

export type ThinkValue = boolean | "low" | "medium" | "high" | "max";

type ThinkingChoice = "default" | "off" | "on" | Exclude<ThinkValue, boolean>;

interface ThinkingProfile {
  readonly values: readonly ThinkingChoice[];
  readonly defaultValue: ThinkingChoice;
  readonly title: "Thinking" | "Thinking Effort";
}

const BOOLEAN_PROFILE: ThinkingProfile = {
  values: ["off", "on"],
  defaultValue: "on",
  title: "Thinking",
};
const GPT_OSS_PROFILE: ThinkingProfile = {
  values: ["low", "medium", "high"],
  defaultValue: "high",
  title: "Thinking Effort",
};
const DEEPSEEK_V4_PROFILE: ThinkingProfile = {
  values: ["off", "high", "max"],
  defaultValue: "high",
  title: "Thinking Effort",
};
const GLM_52_PROFILE: ThinkingProfile = {
  values: ["off", "high", "max"],
  defaultValue: "high",
  title: "Thinking Effort",
};
const GLM_53_PROFILE: ThinkingProfile = {
  values: ["low", "high", "max"],
  defaultValue: "max",
  title: "Thinking Effort",
};
const KIMI_K3_PROFILE: ThinkingProfile = {
  values: ["off", "low", "high", "max"],
  defaultValue: "high",
  title: "Thinking Effort",
};
const MINIMAX_M3_PROFILE: ThinkingProfile = {
  values: ["default", "low", "medium", "high", "max"],
  defaultValue: "high",
  title: "Thinking Effort",
};

const THINKING_PROFILES = new Map<string, ThinkingProfile>([
  ["deepseek-v4-flash:0731", DEEPSEEK_V4_PROFILE],
  ["deepseek-v4-pro:0813", DEEPSEEK_V4_PROFILE],
  ["gemma4:31b", BOOLEAN_PROFILE],
  ["glm-5.1", BOOLEAN_PROFILE],
  ["glm-5.2", GLM_52_PROFILE],
  ["glm-5.3", GLM_53_PROFILE],
  ["glm-5.3-flash", GLM_53_PROFILE],
  ["gpt-oss:20b", GPT_OSS_PROFILE],
  ["gpt-oss:120b", GPT_OSS_PROFILE],
  ["kimi-k2.6", BOOLEAN_PROFILE],
  ["kimi-k2.7-code", BOOLEAN_PROFILE],
  ["kimi-k3", KIMI_K3_PROFILE],
  ["minimax-m3", MINIMAX_M3_PROFILE],
  ["nemotron-3-nano:30b", BOOLEAN_PROFILE],
  ["nemotron-3-super", BOOLEAN_PROFILE],
  ["nemotron-3-ultra", BOOLEAN_PROFILE],
  ["qwen3.5:397b", BOOLEAN_PROFILE],
]);

export function buildThinkingSchema(model: CloudModel): {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
} | undefined {
  if (!model.capabilities.thinking) return undefined;
  const profile = THINKING_PROFILES.get(model.id);
  if (!profile) return undefined;
  return {
    type: "object",
    properties: {
      reasoningEffort: {
        type: "string",
        title: profile.title,
        enum: [...profile.values],
        enumItemLabels: profile.values.map(label),
        enumDescriptions: profile.values.map(description),
        description: profile.values.includes("off")
          ? "Choose the model's thinking mode or reasoning effort"
          : "Choose how much reasoning the model performs",
        default: profile.defaultValue,
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
  const profile = THINKING_PROFILES.get(model.id);
  if (!profile) return undefined;
  const configured = configuration?.reasoningEffort ?? configuration?.thinkingEffort;
  const normalized = normalizeChoice(configured);
  const value = normalized && profile.values.includes(normalized)
    ? normalized
    : profile.defaultValue;
  if (value === "default") return undefined;
  if (value === "off") return false;
  if (value === "on") return true;
  return value;
}

/** A selectable context window tier shown on a model's picker configuration. */
export interface ContextSizeOption {
  /** Context cap in input tokens; 0 selects the model's default handling. */
  readonly value: number;
  /** Short picker label, e.g. "Auto", "128K", or "Maximum". */
  readonly label: string;
  /** Picker description for the tier. */
  readonly description: string;
}

/** Fixed context tiers offered below a model's registered input limit. */
const CONTEXT_SIZE_TIERS: readonly { value: number; label: string }[] = [
  { value: 65_536, label: "64K" },
  { value: 131_072, label: "128K" },
  { value: 200_000, label: "200K" },
];

/** Builds the context window tiers offered for a model's input limit; undefined when no tier fits. */
export function contextSizeOptions(maxInputTokens: number): ContextSizeOption[] | undefined {
  if (!Number.isFinite(maxInputTokens) || maxInputTokens <= CONTEXT_SIZE_TIERS[0].value) return undefined;
  const tiers = CONTEXT_SIZE_TIERS.filter((tier) => tier.value < maxInputTokens);
  if (!tiers.length) return undefined;
  return [
    { value: 0, label: "Auto", description: "Default context handling for this model." },
    ...tiers.map((tier) => ({
      value: tier.value,
      label: tier.label,
      description: `Keep the conversation under ${tier.label} input tokens.`,
    })),
    {
      value: maxInputTokens,
      label: "Maximum",
      description: "Use the model's full available input limit.",
    },
  ];
}

/** Resolves the effective context cap for a request; Auto and Maximum return undefined. */
export function resolveContextCap(contextSize: number, maxInputTokens: number): number | undefined {
  if (!Number.isFinite(contextSize) || contextSize <= 0) return undefined;
  if (!Number.isFinite(maxInputTokens) || maxInputTokens <= 0) return undefined;
  const cap = Math.min(Math.floor(contextSize), maxInputTokens);
  return cap < maxInputTokens ? cap : undefined;
}

/** Reads the opted-in context size from picker configuration; 0 keeps the model's default handling. */
export function resolveContextSize(configuration: Readonly<Record<string, unknown>> | undefined): number {
  const value = configuration?.contextSize;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Combines the model's thinking controls with an optional Context Window control. */
export function buildModelConfigurationSchema(
  model: CloudModel,
  contextOptions: readonly ContextSizeOption[] | undefined,
): { type: "object"; properties: Record<string, Record<string, unknown>> } | undefined {
  const thinking = buildThinkingSchema(model);
  if (!thinking && !contextOptions) return undefined;
  return {
    type: "object",
    properties: {
      ...(thinking?.properties ?? {}),
      ...(contextOptions ? {
        contextSize: {
          type: "number",
          title: "Context Window",
          enum: contextOptions.map((option) => option.value),
          enumItemLabels: contextOptions.map((option) => option.label),
          enumDescriptions: contextOptions.map((option) => option.description),
          default: 0,
          group: "navigation",
        },
      } : {}),
    },
  };
}

function label(value: ThinkingChoice): string {
  if (value === "default") return "Default";
  if (value === "off") return "Off";
  if (value === "on") return "On";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function description(value: ThinkingChoice): string {
  if (value === "default") return "Use the model's native adaptive thinking policy";
  if (value === "off") return "Disable thinking for this request";
  if (value === "on") return "Enable thinking with the model's native policy";
  if (value === "low") return "Use a lower thinking effort";
  if (value === "medium") return "Use a balanced thinking effort";
  if (value === "high") return "Use a higher thinking effort";
  return "Use the model's maximum verified thinking effort";
}

function normalizeChoice(value: unknown): ThinkingChoice | undefined {
  if (value === "disabled") return "off";
  if (value === "enabled") return "on";
  return typeof value === "string" ? value as ThinkingChoice : undefined;
}
