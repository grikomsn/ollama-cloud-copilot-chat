import * as vscode from "vscode";
import { CONFIG_SECTION, DEFAULT_INLINE_MODEL, INLINE_SUGGESTIONS_MODEL_SETTING } from "../autocomplete/config";
import { inlineModelChoices } from "../autocomplete/models";
import { messageOf } from "../errors";
import { OllamaCloudProvider } from "../provider";
import { OLLAMA_CLOUD_API, OLLAMA_CLOUD_ORIGIN } from "../transport/protocol";
import {
  formatUsageRows,
  type UsageDisplayRow,
} from "../usage/domain";

const API_KEYS_URL = "https://ollama.com/settings/keys";
const ACCOUNT_USAGE_URL = "https://ollama.com/settings";

export function registerCommands(
  provider: OllamaCloudProvider,
  output: vscode.OutputChannel,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("ollamaCloudCopilot.manage", () => manage(provider, output)),
    vscode.commands.registerCommand("ollamaCloudCopilot.refreshModels", () => refreshModels(provider)),
    vscode.commands.registerCommand("ollamaCloudCopilot.setInlineSuggestionsModel", () => setInlineSuggestionsModel()),
    vscode.commands.registerCommand("ollamaCloudCopilot.testConnection", () => testConnection(provider, output)),
    vscode.commands.registerCommand("ollamaCloudCopilot.openApiKeys", openApiKeys),
    vscode.commands.registerCommand("ollamaCloudCopilot.showUsage", () => showUsage(provider, output)),
    vscode.commands.registerCommand("ollamaCloudCopilot.openUsage", openAccountUsage),
    vscode.commands.registerCommand("ollamaCloudCopilot.diagnostics", () => diagnostics(provider, output)),
  ];
}

async function manage(
  provider: OllamaCloudProvider,
  output: vscode.OutputChannel,
): Promise<void> {
  const picked = await vscode.window.showQuickPick([
    { label: "$(settings-gear) Manage native model entries and API keys", action: "configure" },
    { label: "$(zap) Set inline suggestions model", action: "inlineModel" },
    { label: "$(check) Test inference", action: "test" },
    { label: "$(pulse) Show subscription usage", action: "usage" },
    { label: "$(refresh) Refresh models", action: "refresh" },
    { label: "$(link-external) Open Ollama API keys", action: "open" },
    { label: "$(link-external) Open account usage", action: "openUsage" },
    { label: "$(output) Show logs", action: "logs" },
    { label: "$(info) Show diagnostics", action: "diagnostics" },
  ], { title: "Ollama Cloud — Manage" });
  if (!picked) return;
  if (picked.action === "configure") await vscode.commands.executeCommand("workbench.action.chat.manage");
  else if (picked.action === "inlineModel") await setInlineSuggestionsModel();
  else if (picked.action === "usage") await showUsage(provider, output);
  else if (picked.action === "refresh") await refreshModels(provider);
  else if (picked.action === "test") await testConnection(provider, output);
  else if (picked.action === "open") await openApiKeys();
  else if (picked.action === "openUsage") await openAccountUsage();
  else if (picked.action === "logs") output.show(true);
  else if (picked.action === "diagnostics") await diagnostics(provider, output);
}

async function refreshModels(provider: OllamaCloudProvider): Promise<void> {
  try {
    const models = await provider.refreshModels();
    vscode.window.showInformationMessage(`Refreshed ${models.length} Ollama Cloud models.`);
  } catch (error) {
    vscode.window.showErrorMessage(messageOf(error));
  }
}

interface InlineModelPickItem extends vscode.QuickPickItem {
  readonly action?: string | "custom";
}

async function setInlineSuggestionsModel(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = configuration.get<string>(INLINE_SUGGESTIONS_MODEL_SETTING, DEFAULT_INLINE_MODEL) ?? DEFAULT_INLINE_MODEL;
  const picked = await vscode.window.showQuickPick<InlineModelPickItem>([
    ...inlineModelChoices(current).map((choice) => ({
      label: choice.label,
      description: choice.description,
      detail: choice.detail,
      action: choice.id,
    })),
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    { label: "$(pencil) Use a custom model id…", detail: "Enter any Ollama Cloud model id that completes cleanly with think disabled.", action: "custom" as const },
  ], {
    title: "Ollama Cloud — Set Inline Suggestions Model",
    placeHolder: `Current: ${current}`,
  });
  if (!picked?.action) return;
  if (picked.action === "custom") {
    const value = await vscode.window.showInputBox({
      title: "Custom inline suggestions model id",
      value: current,
      prompt: "Any Ollama Cloud model id; the vetted list is a starting point, not a restriction.",
    });
    if (value === undefined || !value.trim()) return;
    await configuration.update(INLINE_SUGGESTIONS_MODEL_SETTING, value.trim(), vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage(`Ollama Cloud inline suggestions model set to ${value.trim()}.`);
    return;
  }
  await configuration.update(INLINE_SUGGESTIONS_MODEL_SETTING, picked.action, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(`Ollama Cloud inline suggestions model set to ${picked.action}. Applies on the next keystroke.`);
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
    { label: "$(settings-gear) Manage model entries and API keys", action: "configure" },
  ];
  const picked = await vscode.window.showQuickPick([...rows, ...actions], {
    title: "Ollama Cloud subscription usage",
    placeHolder: "Account activity, available quota windows, and locally tracked inference tokens",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (picked?.action === "refresh") await showUsage(provider, output);
  else if (picked?.action === "open") await openAccountUsage();
  else if (picked?.action === "configure") await vscode.commands.executeCommand("workbench.action.chat.manage");
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

async function diagnostics(
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
