import * as vscode from "vscode";
import { OllamaCloudAuth } from "./auth/auth";
import { messageOf } from "./errors";
import { OllamaCloudProvider } from "./provider";
import { OLLAMA_WEB_SEARCH_TOOL_NAME, OllamaWebSearchTool } from "./tools/registered/web-search";
import { type OllamaUsageSnapshot } from "./usage/domain";
import { renderUsageStatus, updateUsageStatusVisibility } from "./usage/presentation";
import { registerCommands } from "./commands/commands";
const USAGE_STATE_KEY = "ollamaCloudCopilot.usageSnapshot.v1";

export interface OllamaCloudExtensionApi {
  smokeTestWithApiKey(
    apiKey: string,
  ): Promise<{
    modelCount: number;
    model: string;
    text: string;
    sessionUsage?: number;
    weeklyUsage?: number;
  }>;
}

export function activate(
  context: vscode.ExtensionContext,
): OllamaCloudExtensionApi | undefined {
  const output = vscode.window.createOutputChannel("Ollama Cloud");
  const auth = new OllamaCloudAuth(context.secrets);
  const provider = new OllamaCloudProvider(
    auth,
    context.globalState,
    output,
    `ollama-cloud-copilot-chat/${context.extension.packageJSON.version} VSCode/${vscode.version}`,
    context.globalState.get<OllamaUsageSnapshot>(USAGE_STATE_KEY) ?? {},
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
    vscode.lm.registerTool(OLLAMA_WEB_SEARCH_TOOL_NAME, new OllamaWebSearchTool(auth)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("ollamaCloudCopilot")) {
        provider.fireDidChange();
      }
      if (event.affectsConfiguration("ollamaCloudCopilot.showUsageStatusBar")) {
        updateUsageStatusVisibility(usageStatus);
      }
    }),
    provider.onDidChangeUsage((snapshot) => {
      renderUsageStatus(usageStatus, snapshot);
      void context.globalState.update(USAGE_STATE_KEY, snapshot);
    }),
    context.secrets.onDidChange((event) => {
      if (event.key === "ollamaCloudCopilot.apiKey") provider.fireDidChange();
    }),
    ...registerCommands(auth, provider, output),
  );

  output.appendLine(
    `[activate] Ollama Cloud for Copilot Chat ${context.extension.packageJSON.version} on VS Code ${vscode.version}`,
  );
  void auth.hasApiKey().then((configured) => {
    if (!configured) return;
    void provider.refreshModels().catch((error) => {
      output.appendLine(`[models] initial refresh failed: ${messageOf(error)}`);
    });
    void provider.refreshUsage().catch((error) => {
      output.appendLine(`[usage] initial refresh failed: ${messageOf(error)}`);
    });
  });

  return context.extensionMode !== vscode.ExtensionMode.Production
    ? {
        smokeTestWithApiKey: async (apiKey: string) => {
          const result = await provider.smokeTestWithApiKey(apiKey);
          await auth.storeApiKey(apiKey);
          provider.fireDidChange();
          return result;
        },
      }
    : undefined;
}
