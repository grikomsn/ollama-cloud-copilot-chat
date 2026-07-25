import * as vscode from "vscode";
import { OllamaCloudAuth } from "./auth";
import {
  ModelCatalog,
  OLLAMA_CLOUD_API,
  TOKEN_PRICING,
  type CatalogCache,
  type CloudModel,
} from "./catalog";
import { convertMessages, convertTools, messageText } from "./convert";
import { apiError, messageOf } from "./errors";
import { buildThinkingSchema, resolveThinkValue } from "./model-options";
import { NdjsonStreamParser, type OllamaStreamEvent } from "./ndjson";
import {
  mergeAccountUsage,
  recordRequestUsage,
  toUsagePayload,
  type OllamaUsageSnapshot,
} from "./usage";

const USAGE_MIME_TYPE = "usage";

export interface OllamaCloudModelInformation extends vscode.LanguageModelChatInformation {
  readonly rawModelId: string;
  readonly contextLength: number;
}

export class OllamaCloudProvider
implements vscode.LanguageModelChatProvider<OllamaCloudModelInformation> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly usageEmitter = new vscode.EventEmitter<OllamaUsageSnapshot>();
  private readonly catalog: ModelCatalog;
  private readonly charsPerToken = new Map<string, number>();
  private usage: OllamaUsageSnapshot;
  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
  readonly onDidChangeUsage = this.usageEmitter.event;

  constructor(
    private readonly auth: OllamaCloudAuth,
    cache: CatalogCache,
    private readonly output: vscode.OutputChannel,
    private readonly userAgent: string,
    initialUsage: OllamaUsageSnapshot = {},
  ) {
    this.catalog = new ModelCatalog(cache);
    this.usage = initialUsage;
  }

  fireDidChange(): void {
    this.changeEmitter.fire();
  }

  async configureApiKey(apiKey: string): Promise<readonly CloudModel[]> {
    const models = await this.catalog.refresh(apiKey.trim());
    await this.auth.storeApiKey(apiKey);
    this.changeEmitter.fire();
    void this.refreshUsage().catch((error) => {
      this.output.appendLine(`[usage] post-configuration refresh failed: ${messageOf(error)}`);
    });
    return models;
  }

  async clearApiKey(): Promise<void> {
    await this.auth.clearApiKey();
    this.clearUsage();
    this.changeEmitter.fire();
  }

  getUsageSnapshot(): OllamaUsageSnapshot {
    return this.usage;
  }

  clearUsage(): void {
    this.setUsage({});
  }

  async refreshUsage(): Promise<OllamaUsageSnapshot> {
    const apiKey = await this.requireApiKey(false);
    try {
      const response = await fetch(`${OLLAMA_CLOUD_API}/usage`, {
        headers: this.headers(apiKey, "application/json"),
      });
      if (!response.ok) throw await apiError("Unable to load Ollama Cloud subscription usage", response);
      const next = mergeAccountUsage(this.usage, await response.json());
      this.setUsage(next);
      if (next.error) throw new Error(next.error);
      return next;
    } catch (error) {
      this.setUsage({
        ...this.usage,
        updatedAt: Date.now(),
        error: messageOf(error),
      });
      throw error;
    }
  }

  async refreshModels(): Promise<readonly CloudModel[]> {
    const apiKey = await this.requireApiKey(false);
    const models = await this.catalog.refresh(apiKey);
    this.changeEmitter.fire();
    return models;
  }

  async provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<OllamaCloudModelInformation[]> {
    if (token.isCancellationRequested) return [];
    const apiKey = await this.auth.getApiKey();
    const maxAge = Math.max(1, this.configuration.get("catalogCacheMinutes", 30)) * 60_000;
    if (apiKey && !this.catalog.isFresh(maxAge)) {
      const controller = new AbortController();
      const listener = token.onCancellationRequested(() => controller.abort());
      try {
        await this.catalog.refresh(apiKey, controller.signal);
      } catch (error) {
        if (!token.isCancellationRequested) {
          this.output.appendLine(`[models] discovery failed; using cache/snapshot: ${messageOf(error)}`);
        }
      } finally {
        listener.dispose();
      }
    }
    return this.catalog.list().map((model) => this.toModelInformation(model, Boolean(apiKey)));
  }

  async provideLanguageModelChatResponse(
    information: OllamaCloudModelInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const apiKey = await this.requireApiKey(true);
    const model = this.catalog.get(information.rawModelId);
    if (!model) throw new Error(`Unknown Ollama Cloud model: ${information.rawModelId}`);
    const requestChars = messages.reduce((sum, message) => sum + messageText(message).length, 0);
    const maxOutputTokens = Math.min(
      model.maxOutputTokens,
      Math.max(1, this.configuration.get("maxOutputTokens", 32768)),
    );
    const tools = convertTools(options.tools);
    const think = resolveThinkValue(model, options.modelConfiguration);
    const body = {
      model: model.id,
      messages: convertMessages(messages),
      stream: true,
      ...(tools.length ? { tools } : {}),
      ...(think === undefined ? {} : { think }),
      options: { num_predict: maxOutputTokens },
    };

    const controller = new AbortController();
    const timeoutSeconds = Math.max(10, this.configuration.get("requestTimeoutSeconds", 600));
    const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    const cancellation = token.onCancellationRequested(() => controller.abort());
    try {
      const response = await fetch(`${OLLAMA_CLOUD_API}/chat`, {
        method: "POST",
        headers: this.headers(apiKey, "application/x-ndjson"),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw await apiError(`Ollama Cloud request failed for ${model.id}`, response);
      if (!response.body) throw new Error("Ollama Cloud returned an empty response stream");
      if (this.debugLogging) {
        this.output.appendLine(
          `[request] model=${model.id} think=${String(think)} tools=${tools.length} maxOutput=${maxOutputTokens} initiator=${options.requestInitiator ?? "unknown"}`,
        );
      }

      const parser = new NdjsonStreamParser();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        if (token.isCancellationRequested) {
          await reader.cancel();
          return;
        }
        const chunk = await reader.read();
        if (chunk.done) break;
        for (const event of parser.push(decoder.decode(chunk.value, { stream: true }))) {
          this.reportEvent(model, event, progress, requestChars);
        }
      }
      for (const event of parser.push(decoder.decode())) {
        this.reportEvent(model, event, progress, requestChars);
      }
      for (const event of parser.finish()) {
        this.reportEvent(model, event, progress, requestChars);
      }
      void this.refreshUsage().catch((error) => {
        this.output.appendLine(`[usage] post-request refresh failed: ${messageOf(error)}`);
      });
    } catch (error) {
      if (token.isCancellationRequested) return;
      throw error;
    } finally {
      clearTimeout(timeout);
      cancellation.dispose();
    }
  }

  async provideTokenCount(
    model: OllamaCloudModelInformation,
    input: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    const text = messageText(input);
    if (!text.length) return 0;
    return Math.max(1, Math.ceil(text.length / (this.charsPerToken.get(model.rawModelId) ?? 4)));
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
    const models = await this.catalog.refresh(apiKey.trim());
    this.changeEmitter.fire();
    const result = await this.testConnectionWithApiKey(apiKey.trim());
    const usageResponse = await fetch(`${OLLAMA_CLOUD_API}/usage`, {
      headers: this.headers(apiKey.trim(), "application/json"),
    });
    if (!usageResponse.ok) throw await apiError("Ollama Cloud usage smoke test failed", usageResponse);
    const usage = mergeAccountUsage(this.usage, await usageResponse.json());
    this.setUsage(usage);
    return {
      modelCount: models.length,
      ...result,
      sessionUsage: usage.session?.usedRatio,
      weeklyUsage: usage.weekly?.usedRatio,
    };
  }

  private async testConnectionWithApiKey(apiKey: string): Promise<{ model: string; text: string }> {
    const model = this.catalog.get("gpt-oss:20b") ?? this.catalog.list()[0];
    if (!model) throw new Error("No Ollama Cloud model is available");
    const response = await fetch(`${OLLAMA_CLOUD_API}/chat`, {
      method: "POST",
      headers: this.headers(apiKey, "application/json"),
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: "user", content: "Reply with exactly: Ollama Cloud connection verified" }],
        stream: false,
        ...(model.capabilities.thinking ? { think: model.family === "gpt-oss" ? "low" : false } : {}),
        options: { num_predict: 64 },
      }),
    });
    if (!response.ok) throw await apiError("Ollama Cloud inference test failed", response);
    const payload = await response.json() as { message?: { content?: unknown } };
    const text = typeof payload.message?.content === "string" ? payload.message.content.trim() : "";
    return { model: model.id, text: text || "(empty response)" };
  }

  private toModelInformation(model: CloudModel, authenticated: boolean): OllamaCloudModelInformation {
    const modalities = model.capabilities.imageInput ? "text + images" : "text";
    const thinking = model.capabilities.thinking ? "configurable thinking" : "no thinking trace";
    const parameters = [model.parameterSize, model.quantization].filter(Boolean).join(" ");
    const retirement = model.retirementDate ? ` · retires ${model.retirementDate}` : "";
    return {
      id: model.id,
      rawModelId: model.id,
      name: model.name,
      family: model.family,
      version: model.version,
      detail: authenticated ? "Ollama Cloud" : "Ollama Cloud API key required",
      tooltip: [
        `${model.id} · ${formatTokens(model.contextLength)} context`,
        `${modalities} · tools ${model.capabilities.toolCalling ? "supported" : "unavailable"} · ${thinking}`,
        `${TOKEN_PRICING}${parameters ? ` · ${parameters}` : ""}${retirement}`,
      ].join("\n"),
      maxInputTokens: model.contextLength,
      maxOutputTokens: model.maxOutputTokens,
      isUserSelectable: true,
      requiresAuthorization: authenticated ? undefined : { label: "Configure Ollama Cloud API key" },
      pricing: TOKEN_PRICING,
      ...(buildThinkingSchema(model) ? { configurationSchema: buildThinkingSchema(model) } : {}),
      capabilities: {
        imageInput: model.capabilities.imageInput,
        toolCalling: model.capabilities.toolCalling,
      },
      contextLength: model.contextLength,
    };
  }

  private reportEvent(
    model: CloudModel,
    event: OllamaStreamEvent,
    progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
    requestChars: number,
  ): void {
    if (event.error) throw new Error(`Ollama Cloud stream failed for ${model.id}: ${event.error}`);
    if (event.text) progress.report(new vscode.LanguageModelTextPart(event.text));
    if (event.thinking) {
      const ThinkingPart = (vscode as unknown as {
        LanguageModelThinkingPart?: typeof vscode.LanguageModelThinkingPart;
      }).LanguageModelThinkingPart;
      if (ThinkingPart) progress.report(new ThinkingPart(event.thinking));
    }
    let toolIndex = 0;
    for (const tool of event.toolCalls ?? []) {
      progress.report(new vscode.LanguageModelToolCallPart(
        tool.id ?? `ollama-cloud-${Date.now()}-${toolIndex++}`,
        tool.function.name,
        tool.function.arguments,
      ));
    }
    if (event.promptTokens !== undefined && event.completionTokens !== undefined) {
      if (requestChars > 0 && event.promptTokens > 0) {
        const observed = requestChars / event.promptTokens;
        const current = this.charsPerToken.get(model.id) ?? 4;
        this.charsPerToken.set(model.id, current * 0.7 + observed * 0.3);
      }
      const usage = toUsagePayload(event.promptTokens, event.completionTokens);
      this.setUsage(recordRequestUsage(
        this.usage,
        model.id,
        event.promptTokens,
        event.completionTokens,
      ));
      if (this.debugLogging) {
        this.output.appendLine(
          `[usage] model=${model.id} input=${usage.prompt_tokens} output=${usage.completion_tokens} total=${usage.total_tokens}`,
        );
      }
      progress.report(new vscode.LanguageModelDataPart(
        new TextEncoder().encode(JSON.stringify(usage)),
        USAGE_MIME_TYPE,
      ));
    }
  }

  private async requireApiKey(prompt: boolean): Promise<string> {
    let apiKey = await this.auth.getApiKey();
    if (!apiKey && prompt) {
      await vscode.commands.executeCommand("ollamaCloudCopilot.configureApiKey");
      apiKey = await this.auth.getApiKey();
    }
    if (!apiKey) {
      throw new Error("Ollama Cloud API key is not configured. Run ‘Ollama Cloud: Configure API Key’.");
    }
    return apiKey;
  }

  private headers(apiKey: string, accept: string): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: accept,
      "User-Agent": this.userAgent,
    };
  }

  private get configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("ollamaCloudCopilot");
  }

  private get debugLogging(): boolean {
    return this.configuration.get("debugLogging", false);
  }

  private setUsage(usage: OllamaUsageSnapshot): void {
    this.usage = usage;
    this.usageEmitter.fire(usage);
  }
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(3))}M`;
  if (tokens >= 1_000) return `${Number((tokens / 1_000).toFixed(3))}K`;
  return String(tokens);
}
