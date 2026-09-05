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
    badge: "compatible · unmeasured",
    detail: "Accepts think: false per its verified thinking profile.",
  },
  {
    id: "kimi-k3",
    badge: "compatible · unmeasured",
    detail: "Accepts think: false per its verified thinking profile.",
  },
  {
    id: "qwen3.5:397b",
    badge: "compatible · unmeasured",
    detail: "Accepts think: false per its verified thinking profile.",
  },
  {
    id: "nemotron-3-ultra",
    badge: "compatible · unmeasured",
    detail: "Accepts think: false per its verified thinking profile.",
  },
  {
    id: "nemotron-3-super",
    badge: "compatible · unmeasured",
    detail: "Accepts think: false per its verified thinking profile.",
  },
  {
    id: "nemotron-3-nano:30b",
    badge: "compatible · unmeasured",
    detail: "Accepts think: false per its verified thinking profile.",
  },
  {
    id: "kimi-k2.6",
    badge: "⚠ measured: narrates",
    detail: "Returns zero reasoning characters but describes the code instead of completing it; not recommended.",
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
