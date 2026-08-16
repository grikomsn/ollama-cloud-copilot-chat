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
  session?: AccountUsageWindow;
  weekly?: AccountUsageWindow;
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

export interface UsageDisplayRow {
  kind: "session" | "weekly" | "activity" | "tracked" | "request" | "warning" | "empty";
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
    return { ...current, updatedAt, error: "Ollama Cloud usage data did not include account limits" };
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
    updatedAt,
    error: undefined,
  };
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
  ].filter(Boolean);
  if (windows.length) return `$(pulse) Ollama ${windows.join(" · ")}`;
  if (snapshot.error) return "$(warning) Ollama usage";
  return "$(cloud) Ollama Cloud";
}

export function formatUsageTooltip(snapshot: OllamaUsageSnapshot): string {
  const lines = ["Ollama Cloud subscription usage"];
  if (snapshot.session) lines.push(`Session (5h): ${formatPercent(snapshot.session.usedRatio)} used`);
  if (snapshot.weekly) lines.push(`Weekly (7d): ${formatPercent(snapshot.weekly.usedRatio)} used`);
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
    lines.push("Configure an API key to load session and weekly usage.");
  }
  return lines.join("\n");
}

export function formatUsageRows(snapshot: OllamaUsageSnapshot): UsageDisplayRow[] {
  const rows: UsageDisplayRow[] = [];
  if (snapshot.session) rows.push(windowRow("session", "Session usage (5h)", snapshot.session));
  if (snapshot.weekly) rows.push(windowRow("weekly", "Weekly usage (7d)", snapshot.weekly));
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
      description: "Configure an Ollama Cloud API key or refresh usage",
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
  kind: "session" | "weekly",
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
