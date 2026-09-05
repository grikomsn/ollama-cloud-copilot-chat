// Published Ollama Cloud rates from https://ollama.com/pricing, captured
// 2026-09-06. The API does not expose pricing, so this table mirrors the
// pricing page: family rows cover unlisted tags, while tag-specific rows
// (gpt-oss, qwen3.5:397b) apply only to the listed tags. DeepSeek V4 Flash
// and DeepSeek V4 Pro double during peak hours (12:00-18:00 UTC Mon-Fri);
// the picker always shows standard rates.
export interface ModelCost {
  readonly input: number;
  readonly output: number;
  readonly cacheRead?: number;
}

export interface ModelPricingFields {
  readonly pricing: string;
  readonly inputCost: number;
  readonly outputCost: number;
  readonly cacheCost?: number;
  readonly priceCategory: "low" | "medium" | "high" | "very_high";
}

const PUBLISHED_MODEL_COSTS: Readonly<Record<string, ModelCost>> = {
  "deepseek-v4-flash": { input: 0.22, cacheRead: 0.007, output: 0.66 },
  "deepseek-v4-pro": { input: 0.66, cacheRead: 0.022, output: 1.98 },
  "gemma4": { input: 0.14, cacheRead: 0.05, output: 0.4 },
  "glm-5.1": { input: 1, cacheRead: 0.2, output: 3.2 },
  "glm-5.2": { input: 1.4, cacheRead: 0.26, output: 4.4 },
  "glm-5.3": { input: 1.4, cacheRead: 0.26, output: 4.4 },
  "glm-5.3-flash": { input: 0.15, cacheRead: 0.03, output: 0.5 },
  "gpt-oss:120b": { input: 0.15, cacheRead: 0.014, output: 0.6 },
  "gpt-oss:20b": { input: 0.07, cacheRead: 0.035, output: 0.3 },
  "kimi-k2.6": { input: 0.95, cacheRead: 0.16, output: 4 },
  "kimi-k2.7-code": { input: 0.95, cacheRead: 0.19, output: 4 },
  "kimi-k3": { input: 3, cacheRead: 0.3, output: 15 },
  "minimax-m2.7": { input: 0.3, cacheRead: 0.06, output: 1.2 },
  "minimax-m3": { input: 0.6, cacheRead: 0.12, output: 2.4 },
  "mistral-large-3": { input: 0.5, output: 1.5 },
  "nemotron-3-nano": { input: 0.06, output: 0.24 },
  "nemotron-3-super": { input: 0.015, cacheRead: 0.015, output: 0.6 },
  "nemotron-3-ultra": { input: 0.1, cacheRead: 0.1, output: 3 },
  "qwen3.5:397b": { input: 0.6, output: 3.6 },
};

export function ollamaModelCost(id: string): ModelCost | undefined {
  return PUBLISHED_MODEL_COSTS[id] ?? PUBLISHED_MODEL_COSTS[id.split(":")[0]];
}

export function modelPricingFields(cost: ModelCost | undefined): ModelPricingFields | undefined {
  if (!cost) return undefined;
  if (cost.input === 0 && cost.output === 0) {
    return {
      pricing: "Free",
      inputCost: 0,
      outputCost: 0,
      ...(cost.cacheRead === undefined ? {} : { cacheCost: 0 }),
      priceCategory: "low",
    };
  }
  const cached = cost.cacheRead === undefined ? "" : ` · Cached: $${formatPrice(cost.cacheRead)}`;
  return {
    pricing: `In: $${formatPrice(cost.input)}${cached} · Out: $${formatPrice(cost.output)} /1M tokens`,
    inputCost: Math.round(cost.input * 100),
    outputCost: Math.round(cost.output * 100),
    ...(cost.cacheRead === undefined ? {} : { cacheCost: Math.round(cost.cacheRead * 100) }),
    priceCategory: costCategory(cost),
  };
}

export function costCategory(cost: Pick<ModelCost, "input" | "output">): ModelPricingFields["priceCategory"] {
  const weighted = cost.input * 3 + cost.output;
  if (weighted <= 2) return "low";
  if (weighted <= 25) return "medium";
  if (weighted <= 50) return "high";
  return "very_high";
}

function formatPrice(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, "");
}
