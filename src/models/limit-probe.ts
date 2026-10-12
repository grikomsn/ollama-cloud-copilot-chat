// Probe support for per-model max output tokens, ported from
// pi-ollama-cloud's scripts/generate-limits.ts (see
// docs/pi-ollama-cloud-porting-plan.md, R2). /api/show does not publish
// output ceilings, so the limit is recovered from the OpenAI-compatible
// chat endpoint's rejection message by walking ascending max_tokens
// tiers with a stop sequence. The decision logic is pure so
// scripts/refresh-models.mjs (which consumes the compiled output) and the
// colocated tests share one implementation.

/** Ascending max_tokens tiers probed until the API rejects with the exact limit. */
export const PROBE_TIERS = [65536, 131072, 262144, 524288] as const;

/** Extracts the model's maximum output tokens from an OpenAI-compat rejection message. */
export const MAX_OUTPUT_TOKENS_LIMIT_RE = /maximum output tokens \((\d+)\)/;

export type ProbeStep =
  | { action: "accept"; limit: number }
  | { action: "ascend"; nextTier: number }
  | { action: "keep-existing" }
  | { action: "unproven"; limit: number };

/** Parses the exact output limit out of an API rejection message, if present. */
export function parseMaxOutputTokensError(message: string | undefined): number | undefined {
  if (!message) return undefined;
  const match = MAX_OUTPUT_TOKENS_LIMIT_RE.exec(message);
  if (!match) return undefined;
  const limit = Number(match[1]);
  return Number.isSafeInteger(limit) && limit > 0 ? limit : undefined;
}

/**
 * Decides the next step for one probe request result against `tier`.
 * - accepted: keep ascending unless the top tier already passed (unproven:
 *   the real limit may be higher, but the tier value is still the best
 *   verified ceiling).
 * - rejected with a parseable limit: accept the exact value.
 * - rejected otherwise (billing, rate limit, timeout): indeterminate; the
 *   caller keeps the existing snapshot value rather than dropping it.
 */
export function decideProbeStep(tier: number, accepted: boolean, errorMessage?: string): ProbeStep {
  if (accepted) {
    const top = PROBE_TIERS[PROBE_TIERS.length - 1];
    if (tier >= top) return { action: "unproven", limit: top };
    const index = PROBE_TIERS.findIndex((value) => value === tier);
    return { action: "ascend", nextTier: PROBE_TIERS[index + 1] ?? top };
  }
  const parsed = parseMaxOutputTokensError(errorMessage);
  return parsed !== undefined ? { action: "accept", limit: parsed } : { action: "keep-existing" };
}
