import { apiError } from "../errors";
import { OLLAMA_ENDPOINTS, ollamaHeaders } from "../transport/protocol";
import {
  ModelsDevMetadata,
  type ModelsDevModelMetadata,
} from "./metadata";

export const CATALOG_CACHE_KEY = "ollamaCloudCopilot.modelCatalog.v1";
export const TOKEN_PRICING = "Included with Ollama Cloud subscription · no per-token API charge";

export interface ModelCapabilities {
  readonly imageInput: boolean;
  readonly toolCalling: boolean;
  readonly thinking: boolean;
}

export interface CloudModel {
  readonly id: string;
  readonly name: string;
  readonly family: string;
  readonly version: string;
  readonly contextLength: number;
  readonly maxOutputTokens: number;
  readonly parameterSize?: string;
  readonly quantization?: string;
  readonly capabilities: ModelCapabilities;
  readonly retirementDate?: string;
}

interface SnapshotModel {
  readonly id: string;
  readonly contextLength: number;
  readonly maxOutputTokens: number;
  readonly capabilities: string;
  readonly retirementDate?: string;
}

interface TagsPayload {
  models?: Array<{ name?: unknown; model?: unknown }>;
}

interface ShowPayload {
  capabilities?: unknown;
  details?: {
    family?: unknown;
    parameter_size?: unknown;
    quantization_level?: unknown;
  };
  model_info?: Record<string, unknown>;
}

export interface CatalogCache {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

// Context and capability values are hydrated from Ollama Cloud's /api/show.
// This snapshot keeps the picker useful before authentication and records
// output ceilings that /api/show does not currently publish.
const SNAPSHOT: readonly SnapshotModel[] = [
  { id: "deepseek-v4-flash:0731", contextLength: 1048576, maxOutputTokens: 384000, capabilities: "thinking completion tools" },
  { id: "kimi-k3", contextLength: 1048576, maxOutputTokens: 262144, capabilities: "vision thinking completion tools" },
  { id: "kimi-k2.7-code", contextLength: 262144, maxOutputTokens: 262144, capabilities: "vision thinking completion tools" },
  { id: "glm-5.2", contextLength: 1000000, maxOutputTokens: 131072, capabilities: "thinking completion tools" },
  { id: "minimax-m3", contextLength: 524288, maxOutputTokens: 131072, capabilities: "vision thinking completion tools" },
  { id: "nemotron-3-ultra", contextLength: 262144, maxOutputTokens: 131072, capabilities: "thinking completion tools" },
  { id: "deepseek-v4-pro", contextLength: 1048576, maxOutputTokens: 384000, capabilities: "thinking completion tools" },
  { id: "deepseek-v4-pro:0813", contextLength: 1048576, maxOutputTokens: 384000, capabilities: "thinking completion tools" },
  { id: "deepseek-v4-flash", contextLength: 1048576, maxOutputTokens: 384000, capabilities: "thinking completion tools" },
  { id: "gemma4:31b", contextLength: 262144, maxOutputTokens: 128000, capabilities: "vision thinking completion tools" },
  { id: "qwen3.5:397b", contextLength: 262144, maxOutputTokens: 262144, capabilities: "vision thinking completion tools" },
  { id: "kimi-k2.6", contextLength: 262144, maxOutputTokens: 262144, capabilities: "vision thinking completion tools" },
  { id: "minimax-m2.7", contextLength: 196608, maxOutputTokens: 131072, capabilities: "thinking completion tools" },
  { id: "glm-5.1", contextLength: 202752, maxOutputTokens: 131072, capabilities: "thinking completion tools" },
  { id: "nemotron-3-super", contextLength: 262144, maxOutputTokens: 65536, capabilities: "thinking completion tools" },
  { id: "nemotron-3-nano:30b", contextLength: 262144, maxOutputTokens: 131072, capabilities: "thinking completion tools" },
  { id: "mistral-large-3:675b", contextLength: 262144, maxOutputTokens: 262144, capabilities: "vision completion tools" },
  { id: "gpt-oss:120b", contextLength: 131072, maxOutputTokens: 131072, capabilities: "thinking completion tools" },
  { id: "gpt-oss:20b", contextLength: 131072, maxOutputTokens: 131072, capabilities: "thinking completion tools" },
];

const SNAPSHOT_BY_ID = new Map(SNAPSHOT.map((model) => [model.id, model]));

export function fallbackModels(): CloudModel[] {
  return SNAPSHOT.map((model) => modelFromSnapshot(model));
}

export class ModelCatalog {
  private models: CloudModel[];
  private refreshedAt = 0;

  constructor(
    private readonly cache: CatalogCache,
    private readonly fetchImpl: Fetch = fetch,
    metadata?: ModelsDevMetadata,
    private readonly cacheKey = CATALOG_CACHE_KEY,
  ) {
    this.metadata = metadata ?? new ModelsDevMetadata(cache, fetchImpl);
    this.models = parseCachedModels(cache.get<unknown>(cacheKey)) ?? fallbackModels();
  }

  private readonly metadata: ModelsDevMetadata;

  list(): readonly CloudModel[] {
    return this.models;
  }

  get(id: string): CloudModel | undefined {
    return this.models.find((model) => model.id === id);
  }

  isFresh(maxAgeMs: number): boolean {
    return this.refreshedAt > 0 && Date.now() - this.refreshedAt < maxAgeMs;
  }

  async refresh(apiKey: string, signal?: AbortSignal): Promise<CloudModel[]> {
    const headers = ollamaHeaders(apiKey);
    const response = await this.fetchImpl(OLLAMA_ENDPOINTS.models, { headers, signal });
    if (!response.ok) throw await apiError("Unable to list Ollama Cloud models", response);
    const payload = await response.json() as TagsPayload;
    const ids = unique((payload.models ?? []).flatMap((entry) => {
      const value = typeof entry.name === "string"
        ? entry.name
        : typeof entry.model === "string" ? entry.model : "";
      return value.trim() ? [value.trim()] : [];
    }));
    if (!ids.length) throw new Error("Ollama Cloud returned no hosted models");

    const metadataPromise = this.metadata.getOrRefresh();
    const hydrated = await mapConcurrent(ids, 4, async (id) => {
      const fallback = SNAPSHOT_BY_ID.get(id);
      try {
        const show = await this.fetchImpl(OLLAMA_ENDPOINTS.model, {
          method: "POST",
          headers,
          body: JSON.stringify({ model: id, verbose: true }),
          signal,
        });
        const metadata = (await metadataPromise).models[id];
        if (!show.ok) return modelFromSnapshot(fallback ?? unknownSnapshot(id), metadata);
        return modelFromShow(id, await show.json() as ShowPayload, fallback, metadata);
      } catch (error) {
        if (signal?.aborted) throw error;
        const metadata = (await metadataPromise).models[id];
        return modelFromSnapshot(fallback ?? unknownSnapshot(id), metadata);
      }
    });

    this.models = orderModels(hydrated);
    this.refreshedAt = Date.now();
    await this.cache.update(this.cacheKey, this.models);
    return [...this.models];
  }
}

export function modelFromShow(
  id: string,
  show: ShowPayload,
  fallback: SnapshotModel = SNAPSHOT_BY_ID.get(id) ?? unknownSnapshot(id),
  metadata?: ModelsDevModelMetadata,
): CloudModel {
  const hasVerifiedFallback = SNAPSHOT_BY_ID.has(id);
  const capabilityNames = Array.isArray(show.capabilities)
    ? show.capabilities.filter((value): value is string => typeof value === "string")
    : hasVerifiedFallback
      ? fallback.capabilities.split(" ")
      : capabilitiesToNames(metadata) ?? fallback.capabilities.split(" ");
  // Ollama's details.family is the low-level architecture identifier
  // (for example "gptoss" or "minimax-m3"), while VS Code and the
  // thinking-option resolver need a stable product family.
  const family = inferFamily(id);
  const contextLength = findContextLength(show.model_info)
    ?? (hasVerifiedFallback ? undefined : metadata?.contextLength)
    ?? fallback.contextLength;
  const maxOutputTokens = hasVerifiedFallback
    ? fallback.maxOutputTokens
    : metadata?.maxOutputTokens ?? fallback.maxOutputTokens;
  return {
    id,
    name: humanizeModelId(id),
    family,
    version: inferVersion(id),
    contextLength,
    maxOutputTokens: Math.min(maxOutputTokens, contextLength),
    parameterSize: nonEmpty(show.details?.parameter_size),
    quantization: nonEmpty(show.details?.quantization_level),
    capabilities: capabilitiesFrom(capabilityNames),
    retirementDate: fallback.retirementDate,
  };
}

export function findContextLength(info: Record<string, unknown> | undefined): number | undefined {
  if (!info) return undefined;
  for (const [key, value] of Object.entries(info)) {
    if (key.endsWith(".context_length") && validTokenCount(value)) return value;
  }
  return undefined;
}

export function humanizeModelId(id: string): string {
  const words: Record<string, string> = {
    deepseek: "DeepSeek",
    flash: "Flash",
    gemma: "Gemma",
    glm: "GLM",
    gpt: "GPT",
    kimi: "Kimi",
    minimax: "MiniMax",
    mistral: "Mistral",
    nemotron: "Nemotron",
    oss: "OSS",
    pro: "Pro",
    qwen: "Qwen",
    super: "Super",
    ultra: "Ultra",
  };
  return id
    .split(/[-:]/)
    .map((part) => words[part.toLowerCase()] ?? (/^\d/.test(part) ? part.toUpperCase() : capitalize(part)))
    .join(" ");
}

function modelFromSnapshot(model: SnapshotModel, metadata?: ModelsDevModelMetadata): CloudModel {
  const hasVerifiedFallback = SNAPSHOT_BY_ID.has(model.id);
  const contextLength = hasVerifiedFallback
    ? model.contextLength
    : metadata?.contextLength ?? model.contextLength;
  const maxOutputTokens = hasVerifiedFallback
    ? model.maxOutputTokens
    : metadata?.maxOutputTokens ?? model.maxOutputTokens;
  return {
    id: model.id,
    name: humanizeModelId(model.id),
    family: inferFamily(model.id),
    version: inferVersion(model.id),
    contextLength,
    maxOutputTokens: Math.min(maxOutputTokens, contextLength),
    capabilities: hasVerifiedFallback || !metadata
      ? capabilitiesFrom(model.capabilities.split(" "))
      : capabilitiesFromMetadata(metadata),
    retirementDate: model.retirementDate,
  };
}

function capabilitiesFromMetadata(metadata: ModelsDevModelMetadata): ModelCapabilities {
  return {
    imageInput: metadata.imageInput === true,
    toolCalling: metadata.toolCalling === true,
    thinking: metadata.thinking === true,
  };
}

function capabilitiesToNames(metadata: ModelsDevModelMetadata | undefined): string[] | undefined {
  if (!metadata) return undefined;
  const names = [
    metadata.imageInput ? "vision" : undefined,
    metadata.toolCalling ? "tools" : undefined,
    metadata.thinking ? "thinking" : undefined,
  ].filter((value): value is string => value !== undefined);
  return names.length ? names : ["completion"];
}

function parseCachedModels(value: unknown): CloudModel[] | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  const models = value.filter(isCloudModel);
  return models.length === value.length ? models : undefined;
}

function isCloudModel(value: unknown): value is CloudModel {
  if (!value || typeof value !== "object") return false;
  const model = value as Partial<CloudModel>;
  return typeof model.id === "string"
    && typeof model.name === "string"
    && typeof model.family === "string"
    && validTokenCount(model.contextLength)
    && validTokenCount(model.maxOutputTokens)
    && typeof model.capabilities?.imageInput === "boolean"
    && typeof model.capabilities.toolCalling === "boolean"
    && typeof model.capabilities.thinking === "boolean";
}

function capabilitiesFrom(values: readonly string[]): ModelCapabilities {
  const names = new Set(values.map((value) => value.toLowerCase()));
  return {
    imageInput: names.has("vision"),
    toolCalling: names.has("tools"),
    thinking: names.has("thinking"),
  };
}

function inferFamily(id: string): string {
  if (id.startsWith("gpt-oss")) return "gpt-oss";
  if (id.startsWith("deepseek")) return "deepseek";
  if (id.startsWith("minimax")) return "minimax";
  if (id.startsWith("nemotron")) return "nemotron";
  if (id.startsWith("mistral")) return "mistral";
  if (id.startsWith("qwen")) return "qwen";
  if (id.startsWith("gemma")) return "gemma";
  if (id.startsWith("kimi")) return "kimi";
  if (id.startsWith("glm")) return "glm";
  return id.split(/[-:]/)[0] || "ollama-cloud";
}

function inferVersion(id: string): string {
  return id.match(/\d+(?:\.\d+)*/)?.[0] ?? "cloud";
}

function unknownSnapshot(id: string): SnapshotModel {
  return {
    id,
    contextLength: 32768,
    maxOutputTokens: 32768,
    capabilities: "completion",
  };
}

function orderModels(models: readonly CloudModel[]): CloudModel[] {
  const rank = new Map(SNAPSHOT.map((model, index) => [model.id, index]));
  return [...models].sort((left, right) =>
    (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER)
      || left.id.localeCompare(right.id),
  );
}

async function mapConcurrent<T, U>(
  values: readonly T[],
  limit: number,
  mapper: (value: T) => Promise<U>,
): Promise<U[]> {
  const output = new Array<U>(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < values.length) {
      const index = next++;
      output[index] = await mapper(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return output;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function validTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
