import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { withContextOverflowHint } from "./provider/context-error";
import { apiKeyFromConfiguration, credentialReference, NativeEntries } from "./auth/auth";
import {
  CATALOG_CACHE_KEY,
  ModelCatalog,
  TOKEN_PRICING,
  type CatalogCache,
  type CloudModel,
} from "./models/catalog";
import { convertMessages, messageMetrics } from "./provider/messages";
import { apiError, messageOf } from "./errors";
import { buildModelConfigurationSchema, buildThinkingSchema, contextSizeOptions, resolveContextCap, resolveContextSize, resolveThinkValue } from "./models/options";
import { trimHistoryToFit } from "./provider/history-trim";
import { modelPricingFields, ollamaModelCost } from "./models/pricing";
import {
  mergeAccountUsage,
  mergeBalanceUsage,
  recordRequestUsage,
  toUsagePayload,
  type OllamaUsageSnapshot,
} from "./usage/domain";
import { shouldAutoRefreshUsage } from "./usage/throttle";
import {
  createResponseStreamState,
  validateResponseCompletion,
} from "./provider/response-state";
import {
  createResponseUsageState,
  resolveResponseUsage,
  type ResolvedResponseUsage,
} from "./provider/response-usage";
import { estimateInputTokens } from "./provider/token-estimate";
import { OLLAMA_ENDPOINTS, ollamaHeaders } from "./transport/protocol";
import { convertTools } from "./tools/client-tools";
import { bindCredentialToTools } from "./tools/credential-binding";
import { CredentialCapabilities } from "./tools/credential-capabilities";
import { buildChatRequestPlan } from "./provider/request";
import { readOllamaNdjsonStream } from "./transport/ndjson-stream";
import { closeThinking, reportResponseEvent } from "./provider/response";

const USAGE_MIME_TYPE = "usage";

export interface OllamaCloudModelInformation extends vscode.LanguageModelChatInformation {
  readonly rawModelId: string;
  readonly contextLength: number;
  readonly credentialRef: string;
}

export class OllamaCloudProvider
implements vscode.LanguageModelChatProvider<OllamaCloudModelInformation> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly usageEmitter = new vscode.EventEmitter<{ credentialRef: string; usage: OllamaUsageSnapshot }>();
  private readonly catalogs = new Map<string, ModelCatalog>();
  private readonly charsPerToken = new Map<string, number>();
  private readonly usageByCredential = new Map<string, OllamaUsageSnapshot>();
  private readonly lastUsageRefreshAt = new Map<string, number>();
  private readonly credentialCapabilities = new CredentialCapabilities();
  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
  readonly onDidChangeUsage = this.usageEmitter.event;

  constructor(
    private readonly entries: NativeEntries,
    cache: CatalogCache,
    private readonly output: vscode.OutputChannel,
    private readonly userAgent: string,
    initialUsage: Readonly<Record<string, OllamaUsageSnapshot>> = {},
  ) {
    this.cache = cache;
    for (const [credentialRef, usage] of Object.entries(initialUsage)) {
      this.usageByCredential.set(credentialRef, usage);
    }
  }

  private readonly cache: CatalogCache;

  fireDidChange(): void {
    this.changeEmitter.fire();
  }

  getFeatureApiKey(): string | undefined {
    return this.entries.activeApiKey();
  }

  private pruneCatalogs(): void {
    for (const credentialRef of this.catalogs.keys()) {
      if (this.entries.has(credentialRef)) continue;
      this.catalogs.delete(credentialRef);
    }
    for (const credentialRef of this.lastUsageRefreshAt.keys()) {
      if (this.entries.has(credentialRef)) continue;
      this.lastUsageRefreshAt.delete(credentialRef);
    }
  }

  private get activeCredentialRef(): string {
    return credentialReference(this.entries.activeApiKey() ?? "");
  }

  /** Resets locally tracked usage for the active credential. */
  clearUsage(): void {
    this.setUsage(this.activeCredentialRef, {});
  }

  getUsageSnapshot(): OllamaUsageSnapshot {
    return this.usageByCredential.get(this.activeCredentialRef) ?? {};
  }

  getUsageSnapshots(): Readonly<Record<string, OllamaUsageSnapshot>> {
    return Object.fromEntries(this.usageByCredential);
  }

  getActiveCredentialRef(): string {
    return this.activeCredentialRef;
  }

  async getApiKeyForCapability(capability: string): Promise<string | undefined> {
    const binding = this.credentialCapabilities.resolve(capability);
    if (!binding || !this.entries.has(binding)) return undefined;
    return this.entries.keyForCredential(binding);
  }

  async refreshUsage(credentialRef = this.activeCredentialRef): Promise<OllamaUsageSnapshot> {
    const apiKey = this.requireApiKey(credentialRef);
    // Recorded when the fetch starts so failing endpoints are throttled too.
    this.lastUsageRefreshAt.set(credentialRef, Date.now());
    try {
      const response = await fetch(OLLAMA_ENDPOINTS.usage, {
        headers: ollamaHeaders(apiKey, "application/json", this.userAgent),
      });
      if (!response.ok) throw await apiError("Unable to load Ollama Cloud subscription usage", response);
      let next = mergeAccountUsage(this.usageFor(credentialRef), await response.json());
      // Additive balance enrichment: a balance failure degrades gracefully
      // and must never fail an otherwise successful refresh.
      try {
        const balance = await fetch(OLLAMA_ENDPOINTS.balance, {
          headers: ollamaHeaders(apiKey, "application/json", this.userAgent),
        });
        if (balance.ok) {
          next = mergeBalanceUsage(next, await balance.json());
        } else if (this.debugLogging) {
          this.output.appendLine(`[usage] balance refresh skipped: HTTP ${balance.status}`);
        }
      } catch (error) {
        if (this.debugLogging) {
          this.output.appendLine(`[usage] balance refresh failed: ${messageOf(error)}`);
        }
      }
      this.setUsage(credentialRef, next);
      if (next.error) throw new Error(next.error);
      return next;
    } catch (error) {
      this.setUsage(credentialRef, {
        ...this.usageFor(credentialRef),
        updatedAt: Date.now(),
        error: messageOf(error),
      });
      throw error;
    }
  }

  /** Best-effort usage refresh after a chat request, throttled per credential. */
  private refreshUsageAfterRequest(credentialRef: string): void {
    if (!shouldAutoRefreshUsage(Date.now(), this.lastUsageRefreshAt.get(credentialRef))) return;
    void this.refreshUsage(credentialRef).catch((error) => {
      this.output.appendLine(`[usage] post-request refresh failed: ${messageOf(error)}`);
    });
  }

  async refreshModels(): Promise<readonly CloudModel[]> {
    const credentialRef = this.activeCredentialRef;
    const apiKey = this.requireApiKey(credentialRef);
    const models = await this.catalogFor(credentialRef).refresh(apiKey);
    this.changeEmitter.fire();
    return models;
  }

  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<OllamaCloudModelInformation[]> {
    if (token.isCancellationRequested || !options.configuration) return [];
    let apiKey: string | undefined;
    try {
      apiKey = apiKeyFromConfiguration(options.configuration);
      if (!apiKey) throw new Error("Set the Ollama Cloud API key in Manage Language Models");
    } catch (error) {
      const message = messageOf(error);
      this.output.appendLine(`[models] ${message}`);
      if (!options.silent) void vscode.window.showErrorMessage(message);
      return [];
    }
    const credentialRef = this.entries.register(apiKey);
    this.pruneCatalogs();
    const catalog = this.catalogFor(credentialRef);
    const maxAge = Math.max(1, this.configuration.get("catalogCacheMinutes", 30)) * 60_000;
    if (!catalog.isFresh(maxAge)) {
      const controller = new AbortController();
      const listener = token.onCancellationRequested(() => controller.abort());
      try {
        if (token.isCancellationRequested) controller.abort();
        await catalog.refresh(apiKey, controller.signal);
      } catch (error) {
        if (!token.isCancellationRequested) {
          this.output.appendLine(`[models] discovery failed; using cache/snapshot: ${messageOf(error)}`);
        }
      } finally {
        listener.dispose();
      }
    }
    if (token.isCancellationRequested || !this.entries.has(credentialRef)) return [];
    return catalog.list().map((model) => this.toModelInformation(model, credentialRef));
  }

  async provideLanguageModelChatResponse(
    information: OllamaCloudModelInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    if (token.isCancellationRequested) return;
    const apiKey = this.entries.keyForCredential(information.credentialRef);
    if (!apiKey) {
      throw new Error("This entry's API key was replaced or removed. Reselect its model in Manage Language Models.");
    }
    const model = this.catalogFor(information.credentialRef).get(information.rawModelId);
    if (!model) throw new Error(`Unknown Ollama Cloud model: ${information.rawModelId}`);
    const boundTools = bindCredentialToTools(
      convertTools(options.tools),
      this.credentialCapabilities.issue(information.credentialRef),
      model.family === "gpt-oss",
    );
    const tools = boundTools.tools;
    const think = resolveThinkValue(model, options.modelConfiguration);
    const configuredMaxOutputTokens = this.configuration.get("maxOutputTokens", 65536);
    const contextCap = resolveContextCap(
      resolveContextSize(options.modelConfiguration),
      Math.max(1, model.contextLength - Math.min(model.maxOutputTokens, Math.max(1, configuredMaxOutputTokens))),
    );
    const convertedMessages = boundTools.bindMessages(convertMessages(messages, model.capabilities.imageInput));
    const request = buildChatRequestPlan(
      model,
      contextCap === undefined ? convertedMessages : [...trimHistoryToFit(convertedMessages, contextCap).items],
      tools,
      think,
      options.toolMode === vscode.LanguageModelChatToolMode.Required,
      configuredMaxOutputTokens,
      this.charsPerToken.get(calibrationKey(information.credentialRef, model.id)) ?? 4,
    );

    const controller = new AbortController();
    const timeoutSeconds = Math.max(10, this.configuration.get("requestTimeoutSeconds", 600));
    const idleTimeoutSeconds = Math.max(10, this.configuration.get("streamIdleTimeoutSeconds", 120));
    const cancellation = token.onCancellationRequested(() => controller.abort());
    let timedOut: "total" | "idle" | undefined;
    const totalTimeout = setTimeout(() => {
      timedOut = "total";
      controller.abort();
    }, timeoutSeconds * 1000);
    let idleTimeout: ReturnType<typeof setTimeout> | undefined;
    const resetIdleTimeout = (): void => {
      if (idleTimeout) clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => {
        timedOut = "idle";
        controller.abort();
      }, idleTimeoutSeconds * 1000);
    };
    resetIdleTimeout();
    if (token.isCancellationRequested) controller.abort();
    const streamState = createResponseStreamState(randomUUID());
    const responseUsageState = createResponseUsageState();
    try {
      const response = await fetch(OLLAMA_ENDPOINTS.chat, {
        method: "POST",
        headers: ollamaHeaders(apiKey, "application/x-ndjson", this.userAgent),
        body: JSON.stringify(request.body),
        signal: controller.signal,
      });
      if (!response.ok) throw await apiError(`Ollama Cloud request failed for ${model.id}`, response);
      if (!response.body) throw new Error("Ollama Cloud returned an empty response stream");
      if (this.debugLogging) {
        this.output.appendLine(
          `[request] model=${model.id} think=${String(think)} tools=${tools.length} maxOutput=${request.maxOutputTokens}${contextCap !== undefined ? ` contextCap=${contextCap}` : ""} initiator=${options.requestInitiator ?? "unknown"}`,
        );
      }

      const completed = await readOllamaNdjsonStream(
        response.body,
        token,
        (event) => reportResponseEvent(
          model,
          event,
          progress,
          streamState,
          responseUsageState,
          this.debugLogging ? (message) => this.output.appendLine(message) : undefined,
          boundTools.routeToolCall,
        ),
        resetIdleTimeout,
      );
      if (!completed) return;
      if (streamState.sawDone) {
        this.reportUsage(
          model,
          resolveResponseUsage(
            responseUsageState,
            request.estimatedInputTokens,
            this.charsPerToken.get(calibrationKey(information.credentialRef, model.id)) ?? 4,
          ),
          progress,
          request.calibrationChars,
          information.credentialRef,
        );
      }
      if (streamState.outputLimited) {
        throw new Error(
          `${model.id} reached its output limit before completing; increase ollamaCloudCopilot.maxOutputTokens or reduce thinking`,
        );
      }
      validateResponseCompletion(model.id, streamState, request.requiresToolCall);
      this.refreshUsageAfterRequest(information.credentialRef);
    } catch (error) {
      if (token.isCancellationRequested) return;
      if (timedOut) {
        throw new Error(timedOut === "idle"
          ? `Ollama Cloud request for ${model.id} received no data for ${idleTimeoutSeconds} seconds`
          : `Ollama Cloud request for ${model.id} exceeded ${timeoutSeconds} seconds`);
      }
      throw withContextOverflowHint(error);
    } finally {
      closeThinking(progress, streamState);
      clearTimeout(totalTimeout);
      if (idleTimeout) clearTimeout(idleTimeout);
      cancellation.dispose();
    }
  }

  async provideTokenCount(
    model: OllamaCloudModelInformation,
    input: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    const metrics = messageMetrics(input);
    const tokens = estimateInputTokens(
      metrics,
      this.charsPerToken.get(calibrationKey(model.credentialRef, model.rawModelId)) ?? 4,
    );
    return tokens > 0 ? tokens : 0;
  }

  async testConnection(): Promise<{ model: string; text: string }> {
    const apiKey = this.getFeatureApiKey();
    if (!apiKey) throw new Error("Provision an Ollama Cloud entry in Manage Language Models first.");
    return this.testConnectionWithApiKey(apiKey);
  }

  async smokeTestEntry(apiKey: string): Promise<{
    modelCount: number; model: string; text: string; sessionUsage?: number; weeklyUsage?: number; accountActivityAvailable: boolean;
  }> {
    const credentialRef = this.entries.register(apiKey.trim());
    const models = await this.catalogFor(credentialRef).refresh(apiKey.trim());
    const result = await this.testConnectionWithApiKey(apiKey.trim());
    const usage = await this.refreshUsage(credentialRef);
    return { modelCount: models.length, ...result, sessionUsage: usage.session?.usedRatio, weeklyUsage: usage.weekly?.usedRatio, accountActivityAvailable: usage.requestActivity !== undefined };
  }

  private async testConnectionWithApiKey(apiKey: string): Promise<{ model: string; text: string }> {
    const catalog = this.catalogFor(this.activeCredentialRef);
    const model = catalog.get("gpt-oss:20b") ?? catalog.list()[0];
    if (!model) throw new Error("No Ollama Cloud model is available");
    const think = model.family === "gpt-oss"
      ? "low"
      : resolveThinkValue(model, { thinkingEffort: "disabled" });
    const response = await fetch(OLLAMA_ENDPOINTS.chat, {
      method: "POST",
      headers: ollamaHeaders(apiKey, "application/json", this.userAgent),
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: "user", content: "Reply with exactly: Ollama Cloud connection verified" }],
        stream: false,
        ...(think === undefined ? {} : { think }),
        options: { num_predict: 64 },
      }),
    });
    if (!response.ok) throw await apiError("Ollama Cloud inference test failed", response);
    const payload = await response.json() as { message?: { content?: unknown } };
    const text = typeof payload.message?.content === "string" ? payload.message.content.trim() : "";
    if (!text) throw new Error("Ollama Cloud inference test returned no text");
    return { model: model.id, text };
  }

  private toModelInformation(model: CloudModel, credentialRef: string): OllamaCloudModelInformation {
    const modalities = model.capabilities.imageInput ? "text + images" : "text";
    const thinkingSchema = buildThinkingSchema(model);
    const maxOutputTokens = Math.min(
      model.maxOutputTokens,
      Math.max(1, this.configuration.get("maxOutputTokens", 65536)),
    );
    const maxInputTokens = Math.max(1, model.contextLength - maxOutputTokens);
    const configurationSchema = buildModelConfigurationSchema(model, contextSizeOptions(maxInputTokens));
    const thinking = thinkingSchema
      ? "configurable thinking"
      : model.capabilities.thinking ? "model-managed thinking" : "no thinking trace";
    const parameters = [model.parameterSize, model.quantization].filter(Boolean).join(" ");
    const retirement = model.retirementDate ? ` · retires ${model.retirementDate}` : "";
    const pricing = modelPricingFields(ollamaModelCost(model.id));
    return {
      id: model.id,
      rawModelId: model.id,
      credentialRef,
      name: model.name,
      family: model.family,
      version: model.version,
      detail: "Ollama Cloud",
      tooltip: [
        `${model.id} · ${formatTokens(model.contextLength)} context`,
        `${modalities} · tools ${model.capabilities.toolCalling ? "supported" : "unavailable"} · ${thinking}`,
        `${pricing?.pricing ?? TOKEN_PRICING}${parameters ? ` · ${parameters}` : ""}${retirement}`,
      ].join("\n"),
      maxInputTokens,
      maxOutputTokens,
      isUserSelectable: true,
      isBYOK: true,
      requiresAuthorization: { label: "Ollama Cloud" },
      ...(configurationSchema ? { configurationSchema } : {}),
      ...(pricing ?? {}),
      capabilities: {
        imageInput: model.capabilities.imageInput,
        toolCalling: model.capabilities.toolCalling,
      },
      contextLength: model.contextLength,
    };
  }

  private reportUsage(
    model: CloudModel,
    resolved: ResolvedResponseUsage,
    progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
    calibrationChars: number,
    credentialRef: string,
  ): void {
    if (!resolved.promptEstimated && calibrationChars > 0 && resolved.promptTokens > 0) {
      const observed = calibrationChars / resolved.promptTokens;
      const key = calibrationKey(credentialRef, model.id);
      const current = this.charsPerToken.get(key) ?? 4;
      this.charsPerToken.set(key, current * 0.7 + observed * 0.3);
    }
    const usage = toUsagePayload(resolved.promptTokens, resolved.completionTokens);
    this.setUsage(credentialRef, recordRequestUsage(
      this.usageFor(credentialRef),
      model.id,
      resolved.promptTokens,
      resolved.completionTokens,
      Date.now(),
      {
        promptEstimated: resolved.promptEstimated,
        completionEstimated: resolved.completionEstimated,
      },
    ));
    if (this.debugLogging) {
      const source = resolved.promptEstimated || resolved.completionEstimated
        ? resolved.promptEstimated && resolved.completionEstimated ? "estimated" : "mixed"
        : "exact";
      this.output.appendLine(
        `[usage] model=${model.id} input=${usage.prompt_tokens} output=${usage.completion_tokens} total=${usage.total_tokens} source=${source}`,
      );
    }
    progress.report(new vscode.LanguageModelDataPart(
      new TextEncoder().encode(JSON.stringify(usage)),
      USAGE_MIME_TYPE,
    ));
  }

  private requireApiKey(credentialRef = this.activeCredentialRef): string {
    const apiKey = this.entries.keyForCredential(credentialRef);
    if (!apiKey) throw new Error("Provision an Ollama Cloud entry in Manage Language Models first.");
    return apiKey;
  }

  private get configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("ollamaCloudCopilot");
  }

  private get debugLogging(): boolean {
    return this.configuration.get("debugLogging", false);
  }

  private catalogFor(credentialRef: string): ModelCatalog {
    let catalog = this.catalogs.get(credentialRef);
    if (!catalog) {
      catalog = new ModelCatalog(this.cache, fetch, undefined, `${CATALOG_CACHE_KEY}.${credentialRef}`);
      this.catalogs.set(credentialRef, catalog);
    }
    return catalog;
  }

  private usageFor(credentialRef: string): OllamaUsageSnapshot {
    return this.usageByCredential.get(credentialRef) ?? {};
  }

  private setUsage(credentialRef: string, usage: OllamaUsageSnapshot): void {
    this.usageByCredential.set(credentialRef, usage);
    this.usageEmitter.fire({ credentialRef, usage });
  }
}

function calibrationKey(credentialRef: string, modelId: string): string {
  return `${credentialRef}:${modelId}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(3))}M`;
  if (tokens >= 1_000) return `${Number((tokens / 1_000).toFixed(3))}K`;
  return String(tokens);
}
