// Pricing drift support for scripts/refresh-models.mjs (plan R5). The
// ollama.com/pricing model table renders server-side, so rows are extracted
// with a regex instead of an HTML parser dependency (mirroring
// pi-ollama-cloud's generate-pricing). Report-only: the bundled table stays
// hand-maintained because peak/off-peak row labeling and picker price
// categories need human review; this module only computes the drift.

export interface LiveModelPrice {
  readonly input: number;
  readonly cacheRead: number;
  readonly output: number;
}

/**
 * One row of the model pricing table: model name (anchor text — the `href`
 * points at the family library page and is not unique per row), then input,
 * cached input, and output prices. A row with no quoted cache price (some
 * models list a `-` when they offer no cache discount) still matches; its
 * cacheRead is normalized to the input price. The regex hard-codes the
 * column order (Input / Cached input / Output).
 */
const PRICING_ROW_RE =
  /<td[^>]*><a href="\/library\/[^"]+"[^>]*>([^<]+)<\/a><\/td>\s*<td[^>]*>\$([\d.]+)<\/td>\s*<td[^>]*>(?:\$([\d.]+)|-)<\/td>\s*<td[^>]*>\$([\d.]+)<\/td>/g;

/** Extracts the per-model pricing table from the pricing page HTML. */
export function parsePricingRows(html: string): Map<string, LiveModelPrice> {
  const rows = new Map<string, LiveModelPrice>();
  for (const match of html.matchAll(PRICING_ROW_RE)) {
    const [, name, input, cacheRead, output] = match;
    const price: LiveModelPrice = {
      input: Number(input),
      // A `-` in the cached-input column means the model offers no cache
      // discount, so the cache read price equals the input price.
      cacheRead: cacheRead === undefined ? Number(input) : Number(cacheRead),
      output: Number(output),
    };
    // A column reorder would still parse; flag values that would imply a
    // swapped layout instead of silently reporting wrong prices.
    if (price.cacheRead > price.input) {
      throw new Error(
        `pricing row "${name}" has cacheRead (${price.cacheRead}) > input (${price.input}); the table column order may have changed`,
      );
    }
    rows.set(name, price);
  }
  if (rows.size === 0) {
    throw new Error("no pricing rows found on the pricing page — table layout changed?");
  }
  return rows;
}

/** Resolves the live row for a bundled id: exact match first, then the `:tag` family. */
export function resolvePricingRow(
  id: string,
  rows: ReadonlyMap<string, LiveModelPrice>,
): { name: string; price: LiveModelPrice } | undefined {
  const exact = rows.get(id);
  if (exact) return { name: id, price: exact };
  const family = id.split(":")[0];
  const familyPrice = rows.get(family);
  return familyPrice ? { name: family, price: familyPrice } : undefined;
}

export interface PricingDrift {
  readonly id: string;
  readonly diffs: readonly string[];
  /** True when the row may be peak vs off-peak labeling (DeepSeek families). */
  readonly mayBePeakOffPeak: boolean;
}

export interface PricingComparison {
  readonly drifts: readonly PricingDrift[];
  /** Live rows matching no bundled entry or bundled family. */
  readonly unmatchedLiveRows: readonly string[];
  /** Bundled ids with no live table row (possibly retired models). */
  readonly unmatchedBundledIds: readonly string[];
}

/** Compares the bundled table against live rows; pure, no mutation. */
export function comparePricingRows(
  bundled: Readonly<Record<string, LiveModelPrice>>,
  rows: ReadonlyMap<string, LiveModelPrice>,
): PricingComparison {
  const drifts: PricingDrift[] = [];
  const unmatchedBundledIds: string[] = [];
  const bundledFamilies = new Set(Object.keys(bundled).map((id) => id.split(":")[0]));
  for (const [id, cost] of Object.entries(bundled)) {
    const match = resolvePricingRow(id, rows);
    if (!match) {
      unmatchedBundledIds.push(id);
      continue;
    }
    const diffs: string[] = [];
    if (match.price.input !== cost.input) diffs.push(`input ${cost.input} -> ${match.price.input}`);
    if (match.price.cacheRead !== cost.cacheRead) diffs.push(`cacheRead ${cost.cacheRead} -> ${match.price.cacheRead}`);
    if (match.price.output !== cost.output) diffs.push(`output ${cost.output} -> ${match.price.output}`);
    if (diffs.length) {
      drifts.push({ id, diffs, mayBePeakOffPeak: id.startsWith("deepseek-v4") });
    }
  }
  const bundledIds = new Set(Object.keys(bundled));
  const unmatchedLiveRows = [...rows.keys()].filter((name) =>
    !bundledIds.has(name) && !bundledFamilies.has(name.split(":")[0])
  );
  return { drifts, unmatchedLiveRows, unmatchedBundledIds };
}
