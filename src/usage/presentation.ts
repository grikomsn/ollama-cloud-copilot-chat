import * as vscode from "vscode";
import {
  formatUsageStatusBar,
  formatUsageTooltip,
  type OllamaUsageSnapshot,
} from "./domain";

export function renderUsageStatus(
  status: vscode.StatusBarItem,
  snapshot: OllamaUsageSnapshot,
): void {
  status.text = formatUsageStatusBar(snapshot);
  status.tooltip = formatUsageTooltip(snapshot);
}

export function updateUsageStatusVisibility(status: vscode.StatusBarItem): void {
  const visible = vscode.workspace
    .getConfiguration("ollamaCloudCopilot")
    .get("showUsageStatusBar", true);
  if (visible) status.show();
  else status.hide();
}
