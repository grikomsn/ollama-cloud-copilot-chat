import * as vscode from "vscode";
import { registerInlineCompletions } from "./autocomplete";
import { NativeEntries } from "./auth/auth";
import { OllamaCloudProvider } from "./provider";
import { OLLAMA_WEB_SEARCH_TOOL_NAME, OllamaWebSearchTool } from "./tools/registered/web-search";
import { type OllamaUsageSnapshot } from "./usage/domain";
import { renderUsageStatus, updateUsageStatusVisibility } from "./usage/presentation";
import { registerCommands } from "./commands/commands";
const USAGE_STATE_KEY = "ollamaCloudCopilot.usageSnapshots.v2";

export interface OllamaCloudExtensionApi {
  readonly provider: OllamaCloudProvider;
  smokeTestNativeEntry(
    entryId: string, apiKey: string,
  ): Promise<{
    modelCount: number;
    model: string;
    text: string;
    sessionUsage?: number;
    weeklyUsage?: number;
    accountActivityAvailable: boolean;
  }>;
}

export function activate(
  context: vscode.ExtensionContext,
): OllamaCloudExtensionApi | undefined {
  const output = vscode.window.createOutputChannel("Ollama Cloud");
  const entries = new NativeEntries(context.globalState);
  const userAgent = `ollama-cloud-copilot-chat/${context.extension.packageJSON.version} VSCode/${vscode.version}`;
  const storedUsage = context.globalState.get<Readonly<Record<string, OllamaUsageSnapshot>>>(USAGE_STATE_KEY)
    ?? {};
  const provider = new OllamaCloudProvider(
    entries,
    context.globalState,
    output,
    userAgent,
    storedUsage,
  );
  const usageStatus = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    92,
  );
  usageStatus.name = "Ollama Cloud subscription usage";
  usageStatus.command = "ollamaCloudCopilot.showUsage";
  renderUsageStatus(usageStatus, provider.getUsageSnapshot());
  updateUsageStatusVisibility(usageStatus);

  context.subscriptions.push(
    output,
    usageStatus,
    vscode.lm.registerLanguageModelChatProvider("ollama-cloud", provider),
    vscode.lm.registerTool(OLLAMA_WEB_SEARCH_TOOL_NAME, new OllamaWebSearchTool(
      (capability) => provider.getApiKeyForCapability(capability),
    )),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("ollamaCloudCopilot.maxOutputTokens")
        || event.affectsConfiguration("ollamaCloudCopilot.catalogCacheMinutes")) {
        provider.fireDidChange();
      }
      if (event.affectsConfiguration("ollamaCloudCopilot.showUsageStatusBar")) {
        updateUsageStatusVisibility(usageStatus);
      }
    }),
    provider.onDidChangeUsage(({ credentialRef, usage }) => {
      if (credentialRef === provider.getActiveCredentialRef()) renderUsageStatus(usageStatus, usage);
      void context.globalState.update(USAGE_STATE_KEY, provider.getUsageSnapshots());
    }),
    ...registerCommands(provider, output),
    registerInlineCompletions(context, {
      resolveApiKey: async () => provider.getInlineApiKey(vscode.workspace.getConfiguration("ollamaCloudCopilot").get("inlineSuggestionsEntry", "")),
      output,
      userAgent,
    }),
  );

  output.appendLine(
    `[activate] Ollama Cloud for Copilot Chat ${context.extension.packageJSON.version} on VS Code ${vscode.version}`,
  );

  return context.extensionMode !== vscode.ExtensionMode.Production
    ? {
        provider,
        smokeTestNativeEntry: (entryId: string, apiKey: string) => provider.smokeTestNativeEntry(entryId, apiKey),
      }
    : undefined;
}
