import * as vscode from "vscode";
import type { CloudModel } from "../models/catalog";
import type { OllamaStreamEvent } from "../transport/ndjson";
import {
  observeResponseEvent,
  toolCallId,
  type ResponseStreamState,
} from "./response-state";
import { observeResponseUsage, type ResponseUsageState } from "./response-usage";

export function reportResponseEvent(
  model: CloudModel,
  event: OllamaStreamEvent,
  progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
  state: ResponseStreamState,
  usageState: ResponseUsageState,
  logDone?: (message: string) => void,
  routeToolCall: (name: string, input: Record<string, unknown>) => { name: string; input: Record<string, unknown> }
    = (name, input) => ({ name, input }),
): void {
  observeResponseUsage(event, usageState);
  const transition = observeResponseEvent(model.id, event, state);
  if (event.thinking) {
    const ThinkingPart = thinkingPartConstructor();
    if (ThinkingPart) progress.report(new ThinkingPart(event.thinking));
  }
  if (transition.closeThinking) closeThinking(progress, state);
  if (event.text) progress.report(new vscode.LanguageModelTextPart(event.text));
  for (const tool of event.toolCalls ?? []) {
    const routed = routeToolCall(tool.function.name, tool.function.arguments);
    progress.report(new vscode.LanguageModelToolCallPart(
      toolCallId(tool.id, state),
      routed.name,
      routed.input,
    ));
  }
  if (event.done) logDone?.(`[response] model=${model.id} doneReason=${event.doneReason ?? "unspecified"}`);
}

export function closeThinking(
  progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
  state: ResponseStreamState,
): void {
  if (!state.thinkingOpen) return;
  const ThinkingPart = thinkingPartConstructor();
  if (ThinkingPart) progress.report(new ThinkingPart("", "", { vscode_reasoning_done: true }));
  state.thinkingOpen = false;
}

function thinkingPartConstructor(): typeof vscode.LanguageModelThinkingPart | undefined {
  return (vscode as unknown as {
    LanguageModelThinkingPart?: typeof vscode.LanguageModelThinkingPart;
  }).LanguageModelThinkingPart;
}
