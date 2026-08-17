import type { Fetch } from "./catalog";

export const MODELS_DEV_API_URL = "https://models.dev/api.json";
export const MODELS_DEV_CACHE_KEY = "ollamaCloudCopilot.modelsDevMetadata.v1";
export const MODELS_DEV_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MODELS_DEV_TIMEOUT_MS = 15_000;

export interface ModelsDevModelMetadata {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly family?: string;
  readonly contextLength?: number;
  readonly maxOutputTokens?: number;
  readonly imageInput?: boolean;
  readonly toolCalling?: boolean;
  readonly thinking?: boolean;
  readonly reasoningOptions?: readonly string[];
  readonly temperature?: boolean;
  readonly releaseDate?: string;
  readonly lastUpdated?: string;
}

export interface ModelsDevSnapshot {
  readonly fetchedAt: number;
  readonly models: Readonly<Record<string, ModelsDevModelMetadata>>;
}

export interface MetadataCache {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

interface RawModelsDevModel {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  family?: unknown;
  attachment?: unknown;
  reasoning?: unknown;
  reasoning_options?: unknown;
  tool_call?: unknown;
  temperature?: unknown;
  release_date?: unknown;
  last_updated?: unknown;
  modalities?: unknown;
  limit?: unknown;
}

export function normalizeModelsDevSnapshot(
  payload: unknown,
  fetchedAt: number,
): ModelsDevSnapshot {
  const root = asRecord(payload);
  const provider = asRecord(root?.["ollama-cloud"]);
  const rawModels = asRecord(provider?.models);
  if (!rawModels) throw new Error("Models.dev returned no ollama-cloud model catalog");

  const models: Record<string, ModelsDevModelMetadata> = {};
  for (const [key, value] of Object.entries(rawModels)) {
    const model = normalizeModel(key, value);
    if (model) models[model.id] = model;
  }
  if (!Object.keys(models).length) throw new Error("Models.dev returned no usable ollama-cloud models");
  return { fetchedAt, models };
}

export function parseCachedModelsDevSnapshot(value: unknown): ModelsDevSnapshot | undefined {
  const snapshot = asRecord(value);
  if (!snapshot || !validTimestamp(snapshot.fetchedAt)) return undefined;
  const rawModels = asRecord(snapshot.models);
  if (!rawModels) return undefined;

  const models: Record<string, ModelsDevModelMetadata> = {};
  for (const [key, value] of Object.entries(rawModels)) {
    const model = parseCachedModel(key, value);
    if (!model) return undefined;
    models[model.id] = model;
  }
  return { fetchedAt: snapshot.fetchedAt, models };
}

export class ModelsDevMetadata {
  private snapshot: ModelsDevSnapshot | undefined;
  private refreshPromise: Promise<ModelsDevSnapshot> | undefined;
  private loadedCache = false;

  constructor(
    private readonly cache: MetadataCache,
    private readonly fetchImpl: Fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async getOrRefresh(): Promise<ModelsDevSnapshot> {
    this.loadCache();
    if (!this.snapshot) return this.refresh();
    if (this.now() - this.snapshot.fetchedAt >= MODELS_DEV_CACHE_TTL_MS) {
      void this.refresh();
    }
    return this.snapshot;
  }

  async refresh(): Promise<ModelsDevSnapshot> {
    this.loadCache();
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.fetchAndCache().finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }

  getModel(id: string): ModelsDevModelMetadata | undefined {
    this.loadCache();
    return this.snapshot?.models[id];
  }

  private async fetchAndCache(): Promise<ModelsDevSnapshot> {
    try {
      const response = await this.fetchImpl(MODELS_DEV_API_URL, {
        headers: { accept: "application/json" },
        signal: timeoutSignal(),
      });
      if (!response.ok) throw new Error(`Models.dev metadata request failed: ${response.status}`);
      const next = normalizeModelsDevSnapshot(await response.json(), this.now());
      this.snapshot = next;
      try {
        await this.cache.update(MODELS_DEV_CACHE_KEY, next);
      } catch {
        // A cache write must not hide a successful metadata refresh.
      }
      return next;
    } catch {
      return this.snapshot ?? { fetchedAt: 0, models: {} };
    }
  }

  private loadCache(): void {
    if (this.loadedCache) return;
    this.loadedCache = true;
    this.snapshot = parseCachedModelsDevSnapshot(this.cache.get<unknown>(MODELS_DEV_CACHE_KEY));
  }
}

function normalizeModel(key: string, value: unknown): ModelsDevModelMetadata | undefined {
  const raw = asRecord(value) as RawModelsDevModel | undefined;
  if (!raw) return undefined;
  const id = stringValue(raw.id) ?? key.trim();
  if (!id) return undefined;

  const modalities = asRecord(raw.modalities);
  const inputModalities = stringArray(modalities?.input);
  const limit = asRecord(raw.limit);
  const reasoningOptions = normalizeReasoningOptions(raw.reasoning_options);
  return {
    id,
    name: stringValue(raw.name),
    description: stringValue(raw.description),
    family: stringValue(raw.family),
    contextLength: validTokenCount(limit?.context) ? limit.context : undefined,
    maxOutputTokens: validTokenCount(limit?.output) ? limit.output : undefined,
    imageInput: inputModalities.includes("image"),
    toolCalling: raw.tool_call === true,
    thinking: raw.reasoning === true,
    reasoningOptions: reasoningOptions.length ? reasoningOptions : undefined,
    temperature: typeof raw.temperature === "boolean" ? raw.temperature : undefined,
    releaseDate: stringValue(raw.release_date),
    lastUpdated: stringValue(raw.last_updated),
  };
}

function parseCachedModel(key: string, value: unknown): ModelsDevModelMetadata | undefined {
  const model = asRecord(value);
  if (!model) return undefined;
  const id = typeof model.id === "string" && model.id.trim() ? model.id : key;
  if (!id) return undefined;
  if (model.contextLength !== undefined && !validTokenCount(model.contextLength)) return undefined;
  if (model.maxOutputTokens !== undefined && !validTokenCount(model.maxOutputTokens)) return undefined;
  if (model.imageInput !== undefined && typeof model.imageInput !== "boolean") return undefined;
  if (model.toolCalling !== undefined && typeof model.toolCalling !== "boolean") return undefined;
  if (model.thinking !== undefined && typeof model.thinking !== "boolean") return undefined;
  if (model.reasoningOptions !== undefined && !isStringArray(model.reasoningOptions)) return undefined;
  return {
    id,
    name: optionalString(model.name),
    description: optionalString(model.description),
    family: optionalString(model.family),
    contextLength: optionalNumber(model.contextLength),
    maxOutputTokens: optionalNumber(model.maxOutputTokens),
    imageInput: optionalBoolean(model.imageInput),
    toolCalling: optionalBoolean(model.toolCalling),
    thinking: optionalBoolean(model.thinking),
    reasoningOptions: model.reasoningOptions === undefined ? undefined : stringArray(model.reasoningOptions),
    temperature: optionalBoolean(model.temperature),
    releaseDate: optionalString(model.releaseDate),
    lastUpdated: optionalString(model.lastUpdated),
  };
}

function normalizeReasoningOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((entry) => {
    const option = asRecord(entry);
    if (!option) return [];
    if (option.type === "toggle") return ["toggle"];
    return option.type === "effort" ? stringArray(option.values) : [];
  }))];
}

function timeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(MODELS_DEV_TIMEOUT_MS) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : stringValue(value);
}

function optionalNumber(value: unknown): number | undefined {
  return value === undefined ? undefined : validTokenCount(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return value === undefined ? undefined : typeof value === "boolean" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return isStringArray(value)
    ? value.filter((entry): entry is string => Boolean(entry.trim()))
    : [];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
