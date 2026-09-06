/**
 * Vetted inline-completion model candidates, ordered cheap-and-fast first.
 *
 * Badges carry the live-measured (2026-09-06) latency and hidden-reasoning
 * results; unmeasured compatible models are listed after the measured ones and
 * marked as such. The QuickPick command renders this list and writes the
 * selected id to `ollamaCloudCopilot.inlineSuggestionsModel`, so choices need
 * no reload. Unknown model ids stay reachable through the command's custom
 * entry and the raw setting.
 *
 * Pure and unit-tested.
 */

export interface InlineModelCandidate {
  readonly id: string;
  /** Short measured/compatibility badge, e.g. "★ recommended · measured 0.6s TTFB". */
  readonly badge: string;
  /** One-line rationale shown under the model id. */
  readonly detail: string;
}

export const INLINE_MODEL_CANDIDATES: readonly InlineModelCandidate[] = [
  {
    id: "gemma4:31b",
    badge: "★ recommended · measured 0.6s TTFB",
    detail: "Fastest measured model and the smallest hosted size, so credit use stays low; zero hidden reasoning with think: false. A surrounding code fence is stripped automatically.",
  },
  {
    id: "glm-5.1",
    badge: "measured 1.2s TTFB",
    detail: "Zero hidden reasoning with think: false and clean completions; a solid alternate to the default.",
  },
  {
    id: "glm-5.2",
    badge: "measured 1.6s TTFB",
    detail: "Zero hidden reasoning with think: false and a correct completion; a surrounding code fence is stripped automatically.",
  },
  {
    id: "kimi-k2.6",
    badge: "⚠ measured: narrates",
    detail: "Returns zero reasoning characters but describes the code instead of completing it; not recommended.",
  },
  {
    id: "kimi-k3",
    badge: "⚠ measured: rewrites",
    detail: "Re-emits the whole function from its first line instead of filling the cursor; not recommended.",
  },
  {
    id: "kimi-k2.7-code",
    badge: "⚠ measured: narrates",
    detail: "Describes the code instead of completing it with think: false; not recommended.",
  },
  {
    id: "qwen3.5:397b",
    badge: "⚠ measured: narrates",
    detail: "Explains the normalization approach instead of emitting code; not recommended.",
  },
  {
    id: "nemotron-3-ultra",
    badge: "⚠ measured: times out",
    detail: "No completion arrived within a 20s request window; not recommended.",
  },
  {
    id: "nemotron-3-super",
    badge: "⚠ measured: narrates",
    detail: "Describes the completed function instead of emitting code; not recommended.",
  },
  {
    id: "nemotron-3-nano:30b",
    badge: "⚠ measured: narrates",
    detail: "Narrates a ready-to-run rewrite instead of filling the cursor; not recommended.",
  },
  {
    id: "mistral-large-3:675b",
    badge: "⚠ measured: narrates",
    detail: "Natively non-thinking but describes the completion instead of emitting code; not recommended.",
  },
  {
    id: "gpt-oss:20b",
    badge: "⚠ measured: thinking persists",
    detail: "Still emitted 400+ hidden reasoning characters with think: false; not recommended.",
  },
  {
    id: "gpt-oss:120b",
    badge: "⚠ measured: thinking persists",
    detail: "Still emitted 400+ hidden reasoning characters with think: false; not recommended.",
  },
  {
    id: "minimax-m2.7",
    badge: "⚠ measured: disable ignored",
    detail: "Emitted 500+ hidden reasoning characters with think: false; not recommended.",
  },
  {
    id: "deepseek-v4-flash:0731",
    badge: "⚠ measured: narrates",
    detail: "Zero reasoning characters with think: false but narrates prose instead of completing; not recommended.",
  },
  {
    id: "deepseek-v4-pro:0813",
    badge: "⚠ measured: narrates",
    detail: "Same narration behavior as the flash variant; not recommended for ghost text.",
  },
  {
    id: "glm-5.3-flash",
    badge: "⚠ measured: narrates",
    detail: "think: false emits no separate thinking field, but the model narrates its reasoning into the visible content instead of completing (clean on the CrofAI host, broken here); not recommended.",
  },
  {
    id: "glm-5.3",
    badge: "⚠ measured: narrates",
    detail: "Same visible-reasoning narration as glm-5.3-flash with think: false; not recommended.",
  },
];

export interface InlineModelChoice {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly detail: string;
}

/** Build QuickPick-shaped choices, pinning an unlisted current id to the top. */
export function inlineModelChoices(currentId: string): InlineModelChoice[] {
  const listed = INLINE_MODEL_CANDIDATES.map((candidate) => ({
    id: candidate.id,
    label: candidate.id === currentId ? `$(check) ${candidate.id}` : candidate.id,
    description: candidate.badge,
    detail: candidate.detail,
  }));
  const pinned = !INLINE_MODEL_CANDIDATES.some((candidate) => candidate.id === currentId)
    ? [{
      id: currentId,
      label: `$(check) ${currentId}`,
      description: "current value",
      detail: "Kept from your settings; not in the vetted list.",
    }]
    : [];
  return [...pinned, ...listed];
}
