import type { ContextSizeOption } from "../kit/context-size";

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
const MUSE_SPARK_PROFILE: ThinkingProfile = {
  values: ["off", "low", "medium", "high", "max"],
  defaultValue: "high",
  title: "Thinking Effort",
};
const BEAM_PROFILE: ThinkingProfile = {
  values: ["low", "medium", "high", "max"],
  defaultValue: "high",
  title: "Thinking Effort",
};
const HY4_PROFILE: ThinkingProfile = {
  values: ["off", "high"],
  defaultValue: "high",
  title: "Thinking Effort",
};
const MIMO_V26_PROFILE: ThinkingProfile = {
  values: ["low", "medium", "high", "max"],
  defaultValue: "high",
  title: "Thinking Effort",
};

/**
 * Resolves a thinking profile for ids Ollama Cloud has not snapshotted yet.
 * Exact ids win; otherwise the family (the id before the first `:`) inherits
 * the profile verified for that family. Families whose behavior is not uniform
 * stay model-managed, so an unknown tag of those families gets
 * no picker rather than a wrong one.
 */
function thinkingProfile(id: string): ThinkingProfile | undefined {
  const exact = THINKING_PROFILES.get(id);
  if (exact) return exact;
  const family = id.split(":")[0];
  if (family === "gpt-oss") return GPT_OSS_PROFILE;
  if (family === "deepseek-v4-pro" || family === "deepseek-v4.1-flash") return DEEPSEEK_V4_PROFILE;
  if (family === "glm-5.3" || family === "glm-5.3-flash") return GLM_53_PROFILE;
  if (family === "glm-5.2") return GLM_52_PROFILE;
  if (family === "kimi-k3") return KIMI_K3_PROFILE;
  if (family === "minimax-m3" || family === "minimax-m3.1-flash") return MINIMAX_M3_PROFILE;
  if (family === "muse-spark-open") return MUSE_SPARK_PROFILE;
  if (family === "beam") return BEAM_PROFILE;
  if (family === "hy4") return HY4_PROFILE;
  if (family === "mimo-v2.6") return MIMO_V26_PROFILE;
  if (family === "mistral-large-4") return BOOLEAN_PROFILE;
  if (
    family === "gemma4" || family === "kimi-k2.6" || family === "kimi-k2.7-code"
    || family === "kimi-k3.1-pro" || family === "nemotron-3-super" || family === "nemotron-3-ultra"
    || family === "inkling-2-small"
  ) return BOOLEAN_PROFILE;
  return undefined;
}

const THINKING_PROFILES = new Map<string, ThinkingProfile>([
  ["deepseek-v4.1-flash", DEEPSEEK_V4_PROFILE],
  ["deepseek-v4-pro:0813", DEEPSEEK_V4_PROFILE],
  ["gemma4:31b", BOOLEAN_PROFILE],
  ["glm-5.2", GLM_52_PROFILE],
  ["glm-5.3", GLM_53_PROFILE],
  ["glm-5.3-flash", GLM_53_PROFILE],
  ["gpt-oss:20b", GPT_OSS_PROFILE],
  ["gpt-oss:120b", GPT_OSS_PROFILE],
  ["hy4", HY4_PROFILE],
  ["inkling-2-small", BOOLEAN_PROFILE],
  ["kimi-k2.6", BOOLEAN_PROFILE],
  ["kimi-k2.7-code", BOOLEAN_PROFILE],
  ["kimi-k3", KIMI_K3_PROFILE],
  ["kimi-k3.1-pro", BOOLEAN_PROFILE],
  ["mimo-v2.6-flash", MIMO_V26_PROFILE],
  ["mimo-v2.6-pro", MIMO_V26_PROFILE],
  ["minimax-m3", MINIMAX_M3_PROFILE],
  ["minimax-m3.1-flash", MINIMAX_M3_PROFILE],
  ["muse-spark-open", MUSE_SPARK_PROFILE],
  ["beam", BEAM_PROFILE],
  ["mistral-large-4", BOOLEAN_PROFILE],
  ["nemotron-3-super", BOOLEAN_PROFILE],
  ["nemotron-3-ultra", BOOLEAN_PROFILE],
]);

/**
 * Models where disabling thinking still leaks a reasoning trace, verified by
 * live probes (mirroring pi-ollama-cloud's OFF_NULL table): derived profiles
 * hide the `off` choice for these families/ids so the model stays model-managed.
 */
const OFF_NULL_EXACT = new Set(["beam"]);
const OFF_NULL_FAMILIES = ["gpt-oss"];

function hidesOff(id: string): boolean {
  return OFF_NULL_EXACT.has(id) || OFF_NULL_FAMILIES.some((prefix) => id.startsWith(prefix));
}

/** Maps a models.dev effort value onto the picker's graded choice. */
function gradedChoice(value: string): ThinkingChoice | undefined {
  if (value === "low" || value === "medium" || value === "high" || value === "max") return value;
  if (value === "xhigh" || value === "ultra") return "max";
  return undefined;
}

const GRADED_ORDER: readonly ThinkingChoice[] = ["low", "medium", "high", "max"];

/**
 * Derives a picker profile from models.dev reasoning options (plan R4):
 * toggle-only models become boolean, effort values become graded choices
 * (xhigh/ultra fold into max), and `off` is offered unless the model is
 * verified to leak a trace when thinking is disabled. Degenerate results
 * (fewer than two selectable values) yield no picker so the model stays
 * model-managed instead of offering a wrong control.
 */
export function deriveThinkingProfile(id: string, options: readonly string[]): ThinkingProfile | undefined {
  const graded = GRADED_ORDER.filter((choice) => options.some((value) => gradedChoice(value) === choice));
  const toggle = options.includes("toggle");
  if (!toggle && graded.length === 0) return undefined;
  const includeOff = !hidesOff(id);
  if (toggle && graded.length === 0) return includeOff ? BOOLEAN_PROFILE : undefined;
  const values: ThinkingChoice[] = [...(includeOff ? ["off" as const] : []), ...graded];
  if (values.length < 2) return undefined;
  const preferred = values.includes("high") ? "high" : values.includes("max") ? "max" : values[values.length - 1];
  return {
    values,
    defaultValue: preferred,
    title: "Thinking Effort",
  };
}

/** Resolves the thinking profile: hand-verified first, then models.dev-derived. */
function profileFor(model: CloudModel): ThinkingProfile | undefined {
  return thinkingProfile(model.id) ?? deriveThinkingProfile(model.id, model.reasoningOptions ?? []);
}

export function buildThinkingSchema(model: CloudModel): {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
} | undefined {
  if (!model.capabilities.thinking) return undefined;
  const profile = profileFor(model);
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
  const profile = profileFor(model);
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
          type: ["string", "number"],
          title: "Context Window",
          enum: contextOptions.map((option) => option.value),
          enumItemLabels: contextOptions.map((option) => option.label),
          enumDescriptions: contextOptions.map((option) => option.description),
          default: "auto",
          group: "tokens",
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
