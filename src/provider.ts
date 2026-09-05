import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { credentialReference, OllamaCloudAuth } from "./auth/auth";
import {
  CATALOG_CACHE_KEY,
  ModelCatalog,
  TOKEN_PRICING,
  type CatalogCache,
  type CloudModel,
} from "./models/catalog";
import { convertMessages, messageMetrics } from "./provider/messages";
import { apiError, messageOf } from "./errors";
import { buildThinkingSchema, resolveThinkValue } from "./models/options";
import { modelPricingFields, ollamaModelCost } from "./models/pricing";
import {
  mergeAccountUsage,
  recordRequestUsage,
  toUsagePayload,
  type OllamaUsageSnapshot,
} from "./usage/domain";
import {
  createResponseStreamState,
  validateResponseCompletion,
  type ResponseStreamState,
} from "./provider/response-state";
import {
  createResponseUsageState,
  resolveResponseUsage,
  type ResolvedResponseUsage,
  type ResponseUsageState,
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
  private readonly legacyCatalog: ModelCatalog;
  private readonly catalogs = new Map<string, ModelCatalog>();
  private readonly apiKeys = new Map<string, string>();
  private readonly charsPerToken = new Map<string, number>();
  private readonly usageByCredential = new Map<string, OllamaUsageSnapshot>();
  private readonly credentialCapabilities = new CredentialCapabilities();
  private activeCredentialRef = "legacy";
  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
  readonly onDidChangeUsage = this.usageEmitter.event;

  constructor(
    private readonly auth: OllamaCloudAuth,
    cache: CatalogCache,
    private readonly output: vscode.OutputChannel,
    private readonly userAgent: string,
    initialUsage: Readonly<Record<string, OllamaUsageSnapshot>> = {},
  ) {
    this.cache = cache;
    this.legacyCatalog = new ModelCatalog(cache);
    for (const [credentialRef, usage] of Object.entries(initialUsage)) {
      this.usageByCredential.set(credentialRef, usage);
    }
  }

  private readonly cache: CatalogCache;

  fireDidChange(): void {
    this.changeEmitter.fire();
  }

  async configureApiKey(apiKey: string): Promise<readonly CloudModel[]> {
    this.activeCredentialRef = "legacy";
    const models = await this.legacyCatalog.refresh(apiKey.trim());
    await this.auth.storeApiKey(apiKey);
    this.changeEmitter.fire();
    void this.refreshUsage().catch((error) => {
      this.output.appendLine(`[usage] post-configuration refresh failed: ${messageOf(error)}`);
    });
    return models;
  }

  async clearApiKey(): Promise<void> {
    await this.auth.clearApiKey();
    this.setUsage("legacy", {});
    this.changeEmitter.fire();
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
    const credentialRef = this.credentialCapabilities.resolve(capability);
    if (!credentialRef) return undefined;
    return credentialRef === "legacy"
      ? this.auth.getApiKey()
      : this.apiKeys.get(credentialRef);
  }

  clearUsage(): void {
    this.setUsage(this.activeCredentialRef, {});
  }

  async refreshUsage(credentialRef = this.activeCredentialRef): Promise<OllamaUsageSnapshot> {
    const apiKey = await this.requireApiKey(false, credentialRef);
    try {
      const response = await fetch(OLLAMA_ENDPOINTS.usage, {
        headers: ollamaHeaders(apiKey, "application/json", this.userAgent),
      });
      if (!response.ok) throw await apiError("Unable to load Ollama Cloud subscription usage", response);
      const next = mergeAccountUsage(this.usageFor(credentialRef), await response.json());
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

  async refreshModels(): Promise<readonly CloudModel[]> {
    const apiKey = await this.requireApiKey(false, this.activeCredentialRef);
    const models = await this.catalogFor(this.activeCredentialRef).refresh(apiKey);
    this.changeEmitter.fire();
    return models;
  }

  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<OllamaCloudModelInformation[]> {
    if (token.isCancellationRequested) return [];
    if (!options.configuration) return [];
    const apiKey = apiKeyFromConfiguration(options.configuration);
    if (!apiKey) return [];
    const credentialRef = await this.auth.getApiKey() === apiKey ? "legacy" : credentialReference(apiKey);
    this.apiKeys.set(credentialRef, apiKey);
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
    return catalog.list().map((model) => this.toModelInformation(model, credentialRef));
  }

  async provideLanguageModelChatResponse(
    information: OllamaCloudModelInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    this.activeCredentialRef = information.credentialRef;
    const apiKey = await this.requireApiKey(false, information.credentialRef);
    const model = this.catalogFor(information.credentialRef).get(information.rawModelId);
    if (!model) throw new Error(`Unknown Ollama Cloud model: ${information.rawModelId}`);
    const boundTools = bindCredentialToTools(
      convertTools(options.tools),
      this.credentialCapabilities.issue(information.credentialRef),
    );
    const tools = boundTools.tools;
    const think = resolveThinkValue(model, options.modelConfiguration);
    const convertedMessages = boundTools.bindMessages(convertMessages(messages));
    const request = buildChatRequestPlan(
      model,
      convertedMessages,
      tools,
      think,
      options.toolMode === vscode.LanguageModelChatToolMode.Required,
      this.configuration.get("maxOutputTokens", 65536),
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
          `[request] model=${model.id} think=${String(think)} tools=${tools.length} maxOutput=${request.maxOutputTokens} initiator=${options.requestInitiator ?? "unknown"}`,
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
      void this.refreshUsage(information.credentialRef).catch((error) => {
        this.output.appendLine(`[usage] post-request refresh failed: ${messageOf(error)}`);
      });
    } catch (error) {
      if (token.isCancellationRequested) return;
      if (timedOut) {
        throw new Error(timedOut === "idle"
          ? `Ollama Cloud request for ${model.id} received no data for ${idleTimeoutSeconds} seconds`
          : `Ollama Cloud request for ${model.id} exceeded ${timeoutSeconds} seconds`);
      }
      throw error;
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
    const apiKey = await this.requireApiKey(false);
    return this.testConnectionWithApiKey(apiKey);
  }

  async smokeTestWithApiKey(
    apiKey: string,
  ): Promise<{
    modelCount: number;
    model: string;
    text: string;
    sessionUsage?: number;
    weeklyUsage?: number;
  }> {
    this.activeCredentialRef = "legacy";
    const models = await this.legacyCatalog.refresh(apiKey.trim());
    this.changeEmitter.fire();
    const result = await this.testConnectionWithApiKey(apiKey.trim());
    const usageResponse = await fetch(OLLAMA_ENDPOINTS.usage, {
      headers: ollamaHeaders(apiKey.trim(), "application/json", this.userAgent),
    });
    if (!usageResponse.ok) throw await apiError("Ollama Cloud usage smoke test failed", usageResponse);
    const usage = mergeAccountUsage(this.usageFor("legacy"), await usageResponse.json());
    this.setUsage("legacy", usage);
    return {
      modelCount: models.length,
      ...result,
      sessionUsage: usage.session?.usedRatio,
      weeklyUsage: usage.weekly?.usedRatio,
    };
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
    return { model: model.id, text: text || "(empty response)" };
  }

  private toModelInformation(model: CloudModel, credentialRef: string): OllamaCloudModelInformation {
    const modalities = model.capabilities.imageInput ? "text + images" : "text";
    const thinkingSchema = buildThinkingSchema(model);
    const maxOutputTokens = Math.min(
      model.maxOutputTokens,
      Math.max(1, this.configuration.get("maxOutputTokens", 65536)),
    );
    const thinking = thinkingSchema
      ? "configurable thinking"
      : model.capabilities.thinking ? "model-managed thinking" : "no thinking trace";
    const parameters = [model.parameterSize, model.quantization].filter(Boolean).join(" ");
    const retirement = model.retirementDate ? ` · retires ${model.retirementDate}` : "";
    const pricing = modelPricingFields(ollamaModelCost(model.id));
    return {
      id: credentialRef === "legacy" ? model.id : `${credentialRef}::${model.id}`,
      rawModelId: model.id,
      credentialRef,
      name: model.name,
      family: model.family,
      version: model.version,
      detail: `Ollama Cloud · ${credentialRef.slice(0, 8)}`,
      tooltip: [
        `${model.id} · ${formatTokens(model.contextLength)} context`,
        `${modalities} · tools ${model.capabilities.toolCalling ? "supported" : "unavailable"} · ${thinking}`,
        `${pricing?.pricing ?? TOKEN_PRICING}${parameters ? ` · ${parameters}` : ""}${retirement}`,
      ].join("\n"),
      maxInputTokens: Math.max(1, model.contextLength - maxOutputTokens),
      maxOutputTokens,
      isUserSelectable: true,
      isBYOK: true,
      requiresAuthorization: { label: `Ollama Cloud (${credentialRef.slice(0, 8)})` },
      ...(thinkingSchema ? { configurationSchema: thinkingSchema } : {}),
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

  private async requireApiKey(prompt: boolean, credentialRef = this.activeCredentialRef): Promise<string> {
    let apiKey = credentialRef === "legacy"
      ? await this.auth.getApiKey()
      : this.apiKeys.get(credentialRef);
    if (!apiKey && prompt && credentialRef === "legacy") {
      await vscode.commands.executeCommand("ollamaCloudCopilot.configureApiKey");
      apiKey = await this.auth.getApiKey();
    }
    if (!apiKey) {
      throw new Error(credentialRef === "legacy"
        ? "Ollama Cloud API key is not configured. Run ‘Ollama Cloud: Configure API Key’."
        : "The API key for this Ollama Cloud provider entry is unavailable. Update the entry in Manage Language Models.");
    }
    return apiKey;
  }

  private get configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("ollamaCloudCopilot");
  }

  private get debugLogging(): boolean {
    return this.configuration.get("debugLogging", false);
  }

  private catalogFor(credentialRef: string): ModelCatalog {
    if (credentialRef === "legacy") return this.legacyCatalog;
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

function apiKeyFromConfiguration(configuration: Readonly<Record<string, unknown>>): string | undefined {
  const value = configuration.apiKey;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function calibrationKey(credentialRef: string, modelId: string): string {
  return `${credentialRef}:${modelId}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(3))}M`;
  if (tokens >= 1_000) return `${Number((tokens / 1_000).toFixed(3))}K`;
  return String(tokens);
}
