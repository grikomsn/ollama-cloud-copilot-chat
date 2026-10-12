export interface UsagePayload {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface AccountUsageModel {
  name: string;
  requestCount: number;
}

export interface AccountUsageWindow {
  usedRatio: number;
  models: AccountUsageModel[];
}

export interface RequestTokenUsage {
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  recordedAt: number;
  promptEstimated?: boolean;
  completionEstimated?: boolean;
}

export interface TrackedTokenUsage {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedRequests?: number;
}

export interface RequestUsageProvenance {
  promptEstimated?: boolean;
  completionEstimated?: boolean;
}

export interface OllamaUsageSnapshot {
  requestActivity?: { requestCount: number; startsAt?: string; endsAt?: string };
  quotaUnavailable?: boolean;
  session?: AccountUsageWindow;
  weekly?: AccountUsageWindow;
  monthly?: AccountUsageWindow;
  plan?: BalancePlanUsage;
  purchasedUsd?: number;
  activityCost?: string;
  activityPeriod?: {
    type?: string;
    startsAt?: string;
    endsAt?: string;
  };
  lastRequest?: RequestTokenUsage;
  tracked?: TrackedTokenUsage;
  updatedAt?: number;
  error?: string;
}

/** Allowance-derived plan balance from the documented /api/balance endpoint. */
export interface BalancePlanUsage {
  usedRatio: number;
  balanceUsd: number;
  allowanceUsd: number;
  renewsAt?: string;
}

export interface UsageDisplayRow {
  kind: "session" | "weekly" | "monthly" | "plan" | "activity" | "tracked" | "request" | "warning" | "empty";
  label: string;
  description?: string;
  detail?: string;
}

export function toUsagePayload(promptTokens: number, completionTokens: number): UsagePayload {
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
}

export function mergeAccountUsage(
  current: OllamaUsageSnapshot,
  payload: unknown,
  updatedAt = Date.now(),
): OllamaUsageSnapshot {
  if (!isRecord(payload)) {
    return { ...current, updatedAt, error: "Ollama Cloud returned invalid usage data" };
  }
  const limits = isRecord(payload.limits) ? payload.limits : {};
  const activity = isRecord(payload.activity) ? payload.activity : undefined;
  const period = isRecord(activity?.period) ? activity.period : undefined;
  const session = parseWindow(limits.session);
  const weekly = parseWindow(limits.weekly);
  if (!session && !weekly) {
    const totals = isRecord(payload.totals) ? payload.totals : undefined;
    const count = totals?.request_count;
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) {
      return {
        ...current, session: undefined, weekly: undefined, activityCost: undefined, activityPeriod: undefined,
        requestActivity: { requestCount: count, startsAt: stringValue(payload.from), endsAt: stringValue(payload.until) },
        quotaUnavailable: true, updatedAt, error: undefined,
      };
    }
    return { ...current, updatedAt, error: "Ollama Cloud usage data did not include account limits or request activity" };
  }
  return {
    ...current,
    ...(session ? { session } : {}),
    ...(weekly ? { weekly } : {}),
    ...(typeof activity?.cost === "string" ? { activityCost: activity.cost } : {}),
    ...(period ? {
      activityPeriod: compactObject({
        type: stringValue(period.type),
        startsAt: stringValue(period.starting_at),
        endsAt: stringValue(period.ending_at),
      }),
    } : {}),
    quotaUnavailable: false,
    updatedAt,
    error: undefined,
  };
}

// --- Balance enrichment (documented /api/balance endpoint, plan R3) ---

interface BalanceWindowPayload {
  remaining_percent: number;
  resets_at?: string;
}

interface BalanceIncludedPayload {
  session?: BalanceWindowPayload;
  weekly?: BalanceWindowPayload;
  monthly?: BalanceWindowPayload;
  balance_usd?: number;
  allowance_usd?: number;
  period?: { from?: string; until?: string };
}

interface BalanceResponsePayload {
  included?: BalanceIncludedPayload;
  purchased?: { balance_usd?: number };
}

const BALANCE_WINDOW_KEYS = ["session", "weekly", "monthly"] as const;

function isBalanceWindowPayload(value: unknown): value is BalanceWindowPayload {
  if (!isRecord(value) || !isFiniteNumber(value.remaining_percent)) return false;
  return value.resets_at === undefined || typeof value.resets_at === "string";
}

/** Strict validator for the documented /api/balance response shape. */
export function isBalanceResponse(data: unknown): data is BalanceResponsePayload {
  if (!isRecord(data)) return false;
  const purchased = data.purchased;
  const hasPurchased = isRecord(purchased) && isFiniteNumber(purchased.balance_usd);
  if (purchased !== undefined && !hasPurchased) return false;
  const included = data.included;
  if (included === undefined) return hasPurchased;
  if (!isRecord(included)) return false;
  for (const key of BALANCE_WINDOW_KEYS) {
    const window = included[key];
    if (window !== undefined && !isBalanceWindowPayload(window)) return false;
  }
  const balance = included.balance_usd;
  const allowance = included.allowance_usd;
  if (balance !== undefined && !isFiniteNumber(balance)) return false;
  if (allowance !== undefined && !isFiniteNumber(allowance)) return false;
  if ((balance === undefined) !== (allowance === undefined)) return false;
  const period = included.period;
  if (period !== undefined) {
    if (!isRecord(period)) return false;
    if (period.from !== undefined && typeof period.from !== "string") return false;
    if (period.until !== undefined && typeof period.until !== "string") return false;
  }
  const hasWindow = BALANCE_WINDOW_KEYS.some((key) => included[key] !== undefined);
  return hasWindow
    || (isFiniteNumber(balance) && isFiniteNumber(allowance))
    || hasPurchased;
}

function balanceWindowToUsage(window: BalanceWindowPayload): AccountUsageWindow {
  return {
    usedRatio: Math.min(Math.max(1 - window.remaining_percent / 100, 0), 1),
    models: [],
  };
}

/**
 * Merges /api/balance data additively: never overwrites richer account-usage
 * windows and never touches the snapshot error, which stays owned by the
 * account merge. An invalid balance payload leaves the snapshot untouched so
 * a balance problem cannot fail an otherwise successful refresh.
 */
export function mergeBalanceUsage(
  current: OllamaUsageSnapshot,
  payload: unknown,
  updatedAt = Date.now(),
): OllamaUsageSnapshot {
  if (!isBalanceResponse(payload)) return current;
  const next: OllamaUsageSnapshot = { ...current, updatedAt };
  const included = payload.included;
  if (included) {
    for (const key of BALANCE_WINDOW_KEYS) {
      const window = included[key];
      if (window !== undefined && next[key] === undefined) next[key] = balanceWindowToUsage(window);
    }
    if (
      isFiniteNumber(included.balance_usd) && isFiniteNumber(included.allowance_usd)
      && included.allowance_usd > 0
    ) {
      next.plan = {
        usedRatio: Math.min(Math.max(1 - included.balance_usd / included.allowance_usd, 0), 1),
        balanceUsd: included.balance_usd,
        allowanceUsd: included.allowance_usd,
        ...(included.period?.until ? { renewsAt: included.period.until } : {}),
      };
    }
  }
  const purchased = payload.purchased;
  if (purchased?.balance_usd !== undefined && purchased.balance_usd > 0) {
    next.purchasedUsd = purchased.balance_usd;
  }
  return next;
}

export function recordRequestUsage(
  current: OllamaUsageSnapshot,
  modelId: string,
  promptTokens: number,
  completionTokens: number,
  recordedAt = Date.now(),
  provenance: RequestUsageProvenance = {},
): OllamaUsageSnapshot {
  const totalTokens = promptTokens + completionTokens;
  const estimated = provenance.promptEstimated === true
    || provenance.completionEstimated === true;
  return {
    ...current,
    lastRequest: {
      modelId,
      promptTokens,
      completionTokens,
      totalTokens,
      recordedAt,
      ...(provenance.promptEstimated ? { promptEstimated: true } : {}),
      ...(provenance.completionEstimated ? { completionEstimated: true } : {}),
    },
    tracked: {
      requests: (current.tracked?.requests ?? 0) + 1,
      promptTokens: (current.tracked?.promptTokens ?? 0) + promptTokens,
      completionTokens: (current.tracked?.completionTokens ?? 0) + completionTokens,
      totalTokens: (current.tracked?.totalTokens ?? 0) + totalTokens,
      estimatedRequests: (current.tracked?.estimatedRequests ?? 0) + (estimated ? 1 : 0),
    },
  };
}

export function formatUsageStatusBar(snapshot: OllamaUsageSnapshot): string {
  const windows = [
    snapshot.session ? `5h ${formatPercent(snapshot.session.usedRatio)}` : undefined,
    snapshot.weekly ? `7d ${formatPercent(snapshot.weekly.usedRatio)}` : undefined,
    snapshot.monthly ? `30d ${formatPercent(snapshot.monthly.usedRatio)}` : undefined,
  ].filter(Boolean);
  if (windows.length) return `$(pulse) Ollama ${windows.join(" · ")}`;
  if (snapshot.plan) return `$(pulse) Ollama plan ${formatPercent(snapshot.plan.usedRatio)}`;
  if (snapshot.error) return "$(warning) Ollama usage";
  if (snapshot.quotaUnavailable) return "$(cloud) Ollama activity";
  return "$(cloud) Ollama Cloud";
}

export function formatUsageTooltip(snapshot: OllamaUsageSnapshot): string {
  const lines = ["Ollama Cloud subscription usage"];
  if (snapshot.session) lines.push(`Session (5h): ${formatPercent(snapshot.session.usedRatio)} used`);
  if (snapshot.weekly) lines.push(`Weekly (7d): ${formatPercent(snapshot.weekly.usedRatio)} used`);
  if (snapshot.monthly) lines.push(`Monthly (30d): ${formatPercent(snapshot.monthly.usedRatio)} used`);
  if (snapshot.plan) {
    lines.push(
      `Included balance: $${snapshot.plan.balanceUsd.toFixed(2)} of $${snapshot.plan.allowanceUsd.toFixed(2)} remaining`
        + ` (${formatPercent(snapshot.plan.usedRatio)} used)`,
    );
    if (snapshot.plan.renewsAt) lines.push(`Included allowance renews: ${snapshot.plan.renewsAt}`);
  }
  if (snapshot.purchasedUsd !== undefined) lines.push(`Purchased credits: $${snapshot.purchasedUsd.toFixed(2)}`);
  if (snapshot.requestActivity) lines.push(`Account activity: ${snapshot.requestActivity.requestCount.toLocaleString()} requests`);
  if (snapshot.quotaUnavailable) lines.push("The usage endpoint did not provide quota limits.");
  if (snapshot.tracked) {
    const estimateNote = snapshot.tracked.estimatedRequests
      ? ` (${snapshot.tracked.estimatedRequests.toLocaleString()} included estimates)`
      : "";
    lines.push(
      `This extension: ${snapshot.tracked.totalTokens.toLocaleString()} tokens across ${snapshot.tracked.requests.toLocaleString()} requests${estimateNote}`,
    );
  }
  if (snapshot.updatedAt) lines.push(`Updated: ${new Date(snapshot.updatedAt).toLocaleString()}`);
  if (snapshot.error) lines.push(`Last refresh: ${snapshot.error}`);
  if (!snapshot.session && !snapshot.weekly && !snapshot.error) {
    if (!snapshot.requestActivity) lines.push("Select a provisioned native entry and refresh usage.");
  }
  return lines.join("\n");
}

export function formatUsageRows(snapshot: OllamaUsageSnapshot): UsageDisplayRow[] {
  const rows: UsageDisplayRow[] = [];
  if (snapshot.session) rows.push(windowRow("session", "Session usage (5h)", snapshot.session));
  if (snapshot.weekly) rows.push(windowRow("weekly", "Weekly usage (7d)", snapshot.weekly));
  if (snapshot.monthly) rows.push(windowRow("monthly", "Monthly usage (30d)", snapshot.monthly));
  if (snapshot.plan) {
    rows.push({
      kind: "plan",
      label: "Included plan balance",
      description: `$${snapshot.plan.balanceUsd.toFixed(2)} of $${snapshot.plan.allowanceUsd.toFixed(2)} remaining`,
      detail: [
        `${formatPercent(snapshot.plan.usedRatio)} used`,
        snapshot.plan.renewsAt ? `renews ${snapshot.plan.renewsAt}` : undefined,
      ].filter(Boolean).join(" · ") || undefined,
    });
  }
  if (snapshot.purchasedUsd !== undefined) {
    rows.push({
      kind: "plan",
      label: "Purchased credits",
      description: `$${snapshot.purchasedUsd.toFixed(2)}`,
    });
  }
  if (snapshot.requestActivity) rows.push({
    kind: "activity", label: "Account request activity", description: `${snapshot.requestActivity.requestCount.toLocaleString()} requests`,
    detail: [snapshot.requestActivity.startsAt, snapshot.requestActivity.endsAt].filter(Boolean).join(" – "),
  });
  if (snapshot.quotaUnavailable) rows.push({ kind: "warning", label: "Quota limits unavailable", description: "The endpoint returned request activity without quota windows." });
  if (snapshot.activityCost !== undefined) {
    rows.push({
      kind: "activity",
      label: "Account activity cost",
      description: `$${normalizeCost(snapshot.activityCost)}`,
      detail: formatActivityPeriod(snapshot.activityPeriod),
    });
  }
  if (snapshot.tracked) {
    const estimateNote = snapshot.tracked.estimatedRequests
      ? ` · ${snapshot.tracked.estimatedRequests.toLocaleString()} included estimates`
      : "";
    rows.push({
      kind: "tracked",
      label: "Tokens tracked by this extension",
      description: `${snapshot.tracked.totalTokens.toLocaleString()} tokens`,
      detail: `${snapshot.tracked.promptTokens.toLocaleString()} input + ${snapshot.tracked.completionTokens.toLocaleString()} output across ${snapshot.tracked.requests.toLocaleString()} requests${estimateNote}`,
    });
  }
  if (snapshot.lastRequest) {
    const inputKind = snapshot.lastRequest.promptEstimated ? " estimated" : "";
    const outputKind = snapshot.lastRequest.completionEstimated ? " estimated" : "";
    rows.push({
      kind: "request",
      label: "Last extension request",
      description: `${snapshot.lastRequest.totalTokens.toLocaleString()} tokens`,
      detail: `${snapshot.lastRequest.modelId} · ${snapshot.lastRequest.promptTokens.toLocaleString()}${inputKind} input + ${snapshot.lastRequest.completionTokens.toLocaleString()}${outputKind} output`,
    });
  }
  if (snapshot.error) {
    rows.push({
      kind: "warning",
      label: "Usage refresh failed",
      description: snapshot.error,
    });
  }
  if (!rows.length) {
    rows.push({
      kind: "empty",
      label: "Subscription usage not loaded",
      description: "Select a provisioned native entry and refresh usage",
    });
  }
  return rows;
}

function parseWindow(value: unknown): AccountUsageWindow | undefined {
  if (!isRecord(value)) return undefined;
  const usedRatio = finiteNumber(value.usage);
  if (usedRatio === undefined) return undefined;
  const models = Array.isArray(value.models)
    ? value.models.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const name = stringValue(entry.name);
        const requestCount = finiteNumber(entry.request_count);
        return name && requestCount !== undefined ? [{ name, requestCount }] : [];
      })
    : [];
  return {
    usedRatio: Math.max(0, Math.min(1, usedRatio > 1 ? usedRatio / 100 : usedRatio)),
    models,
  };
}

function windowRow(
  kind: "session" | "weekly" | "monthly",
  label: string,
  window: AccountUsageWindow,
): UsageDisplayRow {
  return {
    kind,
    label,
    description: `${progressBar(window.usedRatio)} ${formatPercent(window.usedRatio)} used`,
    detail: modelSummary(window.models),
  };
}

function modelSummary(models: readonly AccountUsageModel[]): string {
  if (!models.length) return "No per-model requests reported";
  return [...models]
    .sort((left, right) => right.requestCount - left.requestCount || left.name.localeCompare(right.name))
    .map((model) => `${model.name}: ${model.requestCount.toLocaleString()} req`)
    .join(" · ");
}

function progressBar(ratio: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(ratio * 10)));
  return `${"●".repeat(filled)}${"○".repeat(10 - filled)}`;
}

function formatPercent(ratio: number): string {
  return `${Number((ratio * 100).toFixed(1))}%`;
}

function normalizeCost(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(5) : value;
}

function formatActivityPeriod(
  period: OllamaUsageSnapshot["activityPeriod"],
): string | undefined {
  if (!period) return undefined;
  const dates = [period.startsAt, period.endsAt]
    .filter((value): value is string => Boolean(value))
    .map((value) => {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? new Date(parsed).toLocaleDateString() : value;
    });
  return [period.type?.replaceAll("_", " "), dates.length === 2 ? `${dates[0]}–${dates[1]}` : dates[0]]
    .filter(Boolean)
    .join(" · ") || undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function compactObject<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
