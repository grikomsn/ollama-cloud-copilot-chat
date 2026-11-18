import { MODELS_DEV_API_URL, MODELS_DEV_CACHE_TTL_MS, RemoteSnapshot, type SnapshotStore } from "../kit/remote-snapshot";

export { MODELS_DEV_API_URL, MODELS_DEV_CACHE_TTL_MS };
export const MODELS_DEV_CACHE_KEY = "ollamaCloudCopilot.modelsDevMetadata.v1";

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

export type MetadataCache = SnapshotStore;

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

/** models.dev enrichment with the kit's persisted stale-while-revalidate lifecycle. */
export class ModelsDevMetadata extends RemoteSnapshot<ModelsDevSnapshot> {
  constructor(cache: MetadataCache, fetchImpl: typeof fetch = fetch, now: () => number = () => Date.now()) {
    super({
      cacheKey: MODELS_DEV_CACHE_KEY,
      store: cache,
      fetch: fetchImpl,
      now,
      normalize: normalizeModelsDevSnapshot,
      parseCached: parseCachedModelsDevSnapshot,
      empty: () => ({ fetchedAt: 0, models: {} }),
    });
  }

  getModel(id: string): ModelsDevModelMetadata | undefined {
    return this.current?.models[id];
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
