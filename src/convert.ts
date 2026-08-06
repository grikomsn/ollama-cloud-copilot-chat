import * as vscode from "vscode";

export interface OllamaMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly thinking?: string;
  readonly images?: readonly string[];
  readonly tool_calls?: readonly OllamaRequestToolCall[];
  readonly tool_name?: string;
}

export interface OllamaRequestToolCall {
  readonly id?: string;
  readonly function: {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  };
}

export interface OllamaTool {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description?: string;
    readonly parameters: Record<string, unknown>;
  };
}

export interface MessageMetrics {
  readonly textChars: number;
  readonly imageCount: number;
}

export function convertMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
): OllamaMessage[] {
  const toolNames = new Map<string, string>();
  for (const message of messages) {
    for (const part of message.content) {
      if (part instanceof vscode.LanguageModelToolCallPart) {
        toolNames.set(part.callId, part.name);
      }
    }
  }
  return messages.flatMap((message) => convertMessage(message, toolNames));
}

export function convertTools(
  tools: readonly vscode.LanguageModelChatTool[] | undefined,
): OllamaTool[] {
  return (tools ?? []).map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      parameters: sanitizeSchema(tool.inputSchema),
    },
  }));
}

export function messageMetrics(
  input: string | vscode.LanguageModelChatRequestMessage,
): MessageMetrics {
  if (typeof input === "string") return { textChars: input.length, imageCount: 0 };
  return input.content.reduce<MessageMetrics>((total, part) => {
    const metrics = partMetrics(part);
    return {
      textChars: total.textChars + metrics.textChars,
      imageCount: total.imageCount + metrics.imageCount,
    };
  }, { textChars: 0, imageCount: 0 });
}

function convertMessage(
  message: vscode.LanguageModelChatRequestMessage,
  toolNames: ReadonlyMap<string, string>,
): OllamaMessage[] {
  const text: string[] = [];
  const thinking: string[] = [];
  const images: string[] = [];
  const toolCalls: OllamaRequestToolCall[] = [];
  const toolResults: OllamaMessage[] = [];

  for (const part of message.content) {
    if (part instanceof vscode.LanguageModelTextPart) {
      text.push(part.value);
    } else if (isThinkingPart(part)) {
      const value = Array.isArray(part.value) ? part.value.join("\n") : part.value;
      if (value) thinking.push(value);
    } else if (part instanceof vscode.LanguageModelDataPart) {
      if (part.mimeType.startsWith("image/")) {
        images.push(Buffer.from(part.data).toString("base64"));
      } else if (part.mimeType.startsWith("text/")) {
        text.push(new TextDecoder().decode(part.data));
      }
    } else if (part instanceof vscode.LanguageModelToolCallPart) {
      toolCalls.push({
        id: part.callId,
        function: {
          name: part.name,
          arguments: record(part.input),
        },
      });
    } else if (part instanceof vscode.LanguageModelToolResultPart) {
      const toolName = toolNames.get(part.callId);
      if (!toolName) {
        throw new Error(`Cannot map tool result ${part.callId} to an Ollama tool name`);
      }
      toolResults.push({
        role: "tool",
        content: part.content.map(partText).filter(Boolean).join("\n"),
        tool_name: toolName,
      });
    }
  }

  const main: OllamaMessage[] = [];
  if (text.length || thinking.length || images.length || toolCalls.length || !toolResults.length) {
    main.push({
      role: role(message.role),
      content: text.join("\n"),
      ...(thinking.length ? { thinking: thinking.join("\n") } : {}),
      ...(images.length ? { images } : {}),
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    });
  }
  return [...main, ...toolResults];
}

function role(value: vscode.LanguageModelChatMessageRole): OllamaMessage["role"] {
  if (value === vscode.LanguageModelChatMessageRole.Assistant) return "assistant";
  const system = (vscode.LanguageModelChatMessageRole as unknown as {
    System?: vscode.LanguageModelChatMessageRole;
  }).System;
  return system !== undefined && value === system ? "system" : "user";
}

function partText(part: vscode.LanguageModelInputPart | unknown): string {
  if (part instanceof vscode.LanguageModelTextPart) return part.value;
  if (isThinkingPart(part)) return Array.isArray(part.value) ? part.value.join("\n") : part.value;
  if (part instanceof vscode.LanguageModelDataPart) {
    if (part.mimeType.startsWith("text/")) return new TextDecoder().decode(part.data);
    if (part.mimeType.startsWith("image/")) return Buffer.from(part.data).toString("base64");
  }
  if (part instanceof vscode.LanguageModelToolCallPart) {
    return `${part.name}\n${JSON.stringify(part.input ?? {})}`;
  }
  if (part instanceof vscode.LanguageModelToolResultPart) {
    return part.content.map(partText).join("\n");
  }
  if (typeof part === "string") return part;
  return "";
}

function partMetrics(part: vscode.LanguageModelInputPart | unknown): MessageMetrics {
  if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith("image/")) {
    return { textChars: 0, imageCount: 1 };
  }
  if (part instanceof vscode.LanguageModelToolResultPart) {
    return part.content.reduce<MessageMetrics>((total, nested) => {
      const metrics = partMetrics(nested);
      return {
        textChars: total.textChars + metrics.textChars,
        imageCount: total.imageCount + metrics.imageCount,
      };
    }, { textChars: 0, imageCount: 0 });
  }
  return { textChars: partText(part).length, imageCount: 0 };
}

function isThinkingPart(value: unknown): value is { value: string | string[] } {
  const ThinkingPart = (vscode as unknown as {
    LanguageModelThinkingPart?: new (...args: never[]) => unknown;
  }).LanguageModelThinkingPart;
  return typeof ThinkingPart === "function" && value instanceof ThinkingPart;
}

function sanitizeSchema(value: unknown): Record<string, unknown> {
  return record(value, { type: "object", properties: {} });
}

function record(value: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : fallback;
}
