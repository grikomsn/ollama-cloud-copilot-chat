import * as vscode from "vscode";
import { OllamaCloudAuth } from "./auth";
import { OLLAMA_CLOUD_API, OLLAMA_CLOUD_ORIGIN } from "./catalog";
import { messageOf } from "./errors";
import { OllamaCloudProvider } from "./provider";
import {
  formatUsageRows,
  formatUsageStatusBar,
  formatUsageTooltip,
  type OllamaUsageSnapshot,
  type UsageDisplayRow,
} from "./usage";

const API_KEYS_URL = "https://ollama.com/settings/keys";
const ACCOUNT_USAGE_URL = "https://ollama.com/settings";
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
    vscode.commands.registerCommand(
      "ollamaCloudCopilot.manage",
      () => manage(auth, provider, output),
    ),
    vscode.commands.registerCommand(
      "ollamaCloudCopilot.configureApiKey",
      () => configureApiKey(provider, output),
    ),
    vscode.commands.registerCommand(
      "ollamaCloudCopilot.removeApiKey",
      () => removeApiKey(provider),
    ),
    vscode.commands.registerCommand(
      "ollamaCloudCopilot.refreshModels",
      () => refreshModels(provider),
    ),
    vscode.commands.registerCommand(
      "ollamaCloudCopilot.testConnection",
      () => testConnection(provider, output),
    ),
    vscode.commands.registerCommand(
      "ollamaCloudCopilot.openApiKeys",
      openApiKeys,
    ),
    vscode.commands.registerCommand(
      "ollamaCloudCopilot.showUsage",
      () => showUsage(provider, output),
    ),
    vscode.commands.registerCommand(
      "ollamaCloudCopilot.openUsage",
      openAccountUsage,
    ),
    vscode.commands.registerCommand(
      "ollamaCloudCopilot.diagnostics",
      () => diagnostics(auth, provider, output),
    ),
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

async function manage(
  auth: OllamaCloudAuth,
  provider: OllamaCloudProvider,
  output: vscode.OutputChannel,
): Promise<void> {
  const configured = await auth.hasApiKey();
  const choices = configured
    ? [
        { label: "$(check) Test Ollama Cloud inference", action: "test" },
        { label: "$(pulse) Show subscription usage", action: "usage" },
        { label: "$(refresh) Refresh cloud models", action: "refresh" },
        { label: "$(key) Replace API key", action: "configure" },
        { label: "$(link-external) Open Ollama API keys", action: "open" },
        { label: "$(link-external) Open Ollama account usage", action: "openUsage" },
        { label: "$(output) Show Ollama Cloud logs", action: "logs" },
        { label: "$(info) Show diagnostics", action: "diagnostics" },
        { label: "$(trash) Remove API key", action: "remove" },
      ]
    : [
        { label: "$(key) Configure Ollama Cloud API key", action: "configure" },
        { label: "$(link-external) Open Ollama API keys", action: "open" },
        { label: "$(link-external) Open Ollama account usage", action: "openUsage" },
        { label: "$(output) Show Ollama Cloud logs", action: "logs" },
      ];
  const picked = await vscode.window.showQuickPick(choices, {
    title: `Ollama Cloud — API key ${configured ? "configured" : "not configured"}`,
  });
  if (!picked) return;
  if (picked.action === "configure") await configureApiKey(provider, output);
  else if (picked.action === "usage") await showUsage(provider, output);
  else if (picked.action === "refresh") await refreshModels(provider);
  else if (picked.action === "test") await testConnection(provider, output);
  else if (picked.action === "open") await openApiKeys();
  else if (picked.action === "openUsage") await openAccountUsage();
  else if (picked.action === "logs") output.show(true);
  else if (picked.action === "diagnostics") await diagnostics(auth, provider, output);
  else if (picked.action === "remove") await removeApiKey(provider);
}

async function configureApiKey(
  provider: OllamaCloudProvider,
  output: vscode.OutputChannel,
): Promise<boolean> {
  const apiKey = await vscode.window.showInputBox({
    title: "Configure Ollama Cloud API key",
    prompt: "The key is validated with Ollama Cloud, then stored in VS Code Secret Storage.",
    placeHolder: "Paste your Ollama API key",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => value.trim() ? undefined : "Enter an Ollama Cloud API key",
  });
  if (!apiKey) return false;
  try {
    const models = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Validating Ollama Cloud API key…" },
      () => provider.configureApiKey(apiKey),
    );
    output.appendLine(`[auth] API key configured; discovered models=${models.length}`);
    vscode.window.showInformationMessage(`Ollama Cloud connected. Found ${models.length} hosted models.`);
    return true;
  } catch (error) {
    const message = messageOf(error);
    output.appendLine(`[auth] API key validation failed: ${message}`);
    vscode.window.showErrorMessage(`Ollama Cloud API key was not saved: ${message}`);
    return false;
  }
}

async function removeApiKey(provider: OllamaCloudProvider): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    "Remove the Ollama Cloud API key from VS Code Secret Storage?",
    { modal: true },
    "Remove API Key",
  );
  if (choice !== "Remove API Key") return;
  await provider.clearApiKey();
  vscode.window.showInformationMessage("Ollama Cloud API key removed.");
}

async function refreshModels(provider: OllamaCloudProvider): Promise<void> {
  try {
    const models = await provider.refreshModels();
    vscode.window.showInformationMessage(`Refreshed ${models.length} Ollama Cloud models.`);
  } catch (error) {
    vscode.window.showErrorMessage(messageOf(error));
  }
}

async function testConnection(
  provider: OllamaCloudProvider,
  output: vscode.OutputChannel,
): Promise<void> {
  try {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Testing Ollama Cloud inference…" },
      () => provider.testConnection(),
    );
    output.appendLine(`[test] model=${result.model} responseLength=${result.text.length}`);
    vscode.window.showInformationMessage(
      `Ollama Cloud verified with ${result.model}: ${result.text}`,
    );
  } catch (error) {
    const message = messageOf(error);
    output.appendLine(`[test] ${message}`);
    vscode.window.showErrorMessage(`Ollama Cloud inference test failed: ${message}`);
  }
}

async function openApiKeys(): Promise<void> {
  const opened = await vscode.env.openExternal(vscode.Uri.parse(API_KEYS_URL));
  if (!opened) vscode.window.showWarningMessage("VS Code could not open Ollama API keys.");
}

async function openAccountUsage(): Promise<void> {
  const opened = await vscode.env.openExternal(vscode.Uri.parse(ACCOUNT_USAGE_URL));
  if (!opened) vscode.window.showWarningMessage("VS Code could not open Ollama account usage.");
}

interface UsageQuickPickItem extends vscode.QuickPickItem {
  action?: "configure" | "open" | "refresh";
}

async function showUsage(
  provider: OllamaCloudProvider,
  output: vscode.OutputChannel,
): Promise<void> {
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: "Refreshing Ollama Cloud subscription usage…",
      },
      () => provider.refreshUsage(),
    );
  } catch (error) {
    output.appendLine(`[usage] manual refresh failed: ${messageOf(error)}`);
  }

  const rows = formatUsageRows(provider.getUsageSnapshot()).map(toUsageQuickPickItem);
  const actions: UsageQuickPickItem[] = [
    { label: "Actions", kind: vscode.QuickPickItemKind.Separator },
    { label: "$(refresh) Refresh usage", action: "refresh" },
    { label: "$(link-external) Open Ollama account usage", action: "open" },
    { label: "$(key) Configure or replace API key", action: "configure" },
  ];
  const picked = await vscode.window.showQuickPick([...rows, ...actions], {
    title: "Ollama Cloud subscription usage",
    placeHolder: "Exact account windows from Ollama plus locally tracked inference tokens",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (picked?.action === "refresh") await showUsage(provider, output);
  else if (picked?.action === "open") await openAccountUsage();
  else if (picked?.action === "configure") await configureApiKey(provider, output);
}

function toUsageQuickPickItem(row: UsageDisplayRow): UsageQuickPickItem {
  const icons: Record<UsageDisplayRow["kind"], string> = {
    session: "$(watch)",
    weekly: "$(calendar)",
    activity: "$(credit-card)",
    tracked: "$(symbol-numeric)",
    request: "$(history)",
    warning: "$(warning)",
    empty: "$(info)",
  };
  return {
    label: `${icons[row.kind]} ${row.label}`,
    description: row.description,
    detail: row.detail,
  };
}

function renderUsageStatus(
  status: vscode.StatusBarItem,
  snapshot: OllamaUsageSnapshot,
): void {
  status.text = formatUsageStatusBar(snapshot);
  status.tooltip = formatUsageTooltip(snapshot);
}

function updateUsageStatusVisibility(status: vscode.StatusBarItem): void {
  const visible = vscode.workspace
    .getConfiguration("ollamaCloudCopilot")
    .get("showUsageStatusBar", true);
  if (visible) status.show();
  else status.hide();
}

async function diagnostics(
  auth: OllamaCloudAuth,
  provider: OllamaCloudProvider,
  output: vscode.OutputChannel,
): Promise<void> {
  const models = await vscode.lm.selectChatModels({ vendor: "ollama-cloud" });
  const usage = provider.getUsageSnapshot();
  const lines = [
    "# Ollama Cloud for Copilot Chat diagnostics",
    "",
    `- VS Code: ${vscode.version}`,
    `- API endpoint: ${OLLAMA_CLOUD_API}`,
    `- Local Ollama required: no`,
    `- API key: ${(await auth.hasApiKey()) ? "configured in Secret Storage" : "missing"}`,
    `- Registered models: ${models.length}`,
    `- Session usage (5h): ${usage.session ? `${(usage.session.usedRatio * 100).toFixed(1)}%` : "not loaded"}`,
    `- Weekly usage (7d): ${usage.weekly ? `${(usage.weekly.usedRatio * 100).toFixed(1)}%` : "not loaded"}`,
    "",
    ...models.map((model) =>
      `- ${model.id}: ${model.maxInputTokens.toLocaleString()} advertised input tokens`,
    ),
  ];
  output.appendLine(`[diagnostics] origin=${OLLAMA_CLOUD_ORIGIN} models=${models.length}`);
  const document = await vscode.workspace.openTextDocument({
    content: lines.join("\n"),
    language: "markdown",
  });
  await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
}
