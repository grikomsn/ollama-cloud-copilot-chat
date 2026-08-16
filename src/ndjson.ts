import {
  ToolCallAccumulator,
  type OllamaToolCall,
  type OllamaToolCallFragment,
} from "./tool-calls";

export type { OllamaToolCall, OllamaToolCallFragment } from "./tool-calls";

export interface OllamaStreamEvent {
  readonly text?: string;
  readonly thinking?: string;
  readonly toolCalls?: readonly OllamaToolCall[];
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly error?: string;
  readonly done?: boolean;
  readonly doneReason?: string;
}

interface NativeChunk {
  error?: unknown;
  message?: {
    content?: unknown;
    thinking?: unknown;
    tool_calls?: unknown;
  };
  prompt_eval_count?: unknown;
  eval_count?: unknown;
  done?: unknown;
  done_reason?: unknown;
}

export class NdjsonStreamParser {
  private buffer = "";
  private readonly toolCalls = new ToolCallAccumulator();

  push(chunk: string): OllamaStreamEvent[] {
    this.buffer += chunk;
    const events: OllamaStreamEvent[] = [];
    let boundary: number;
    while ((boundary = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, boundary).trim();
      this.buffer = this.buffer.slice(boundary + 1);
      const event = this.normalize(parseLine(line));
      if (event) events.push(event);
    }
    return events;
  }

  finish(): OllamaStreamEvent[] {
    const line = this.buffer.trim();
    this.buffer = "";
    const event = this.normalize(parseLine(line));
    return event ? [event] : [];
  }

  private normalize(event: ParsedStreamEvent | undefined): OllamaStreamEvent | undefined {
    if (!event) return undefined;
    if (event.toolCalls?.length) this.toolCalls.add(event.toolCalls);
    const { toolCalls: _fragments, ...withoutToolCalls } = event;
    if (!event.done) return hasEventData(withoutToolCalls) ? withoutToolCalls : undefined;
    const result = this.toolCalls.finish();
    return {
      ...withoutToolCalls,
      ...(result.calls.length ? { toolCalls: result.calls } : {}),
      ...(result.error ? { error: result.error } : {}),
    };
  }
}

type ParsedStreamEvent = Omit<OllamaStreamEvent, "toolCalls"> & {
  readonly toolCalls?: readonly OllamaToolCallFragment[];
};

function parseLine(line: string): ParsedStreamEvent | undefined {
  if (!line) return undefined;
  let chunk: NativeChunk;
  try {
    chunk = JSON.parse(line) as NativeChunk;
  } catch {
    return { error: "Ollama Cloud returned malformed NDJSON" };
  }
  const text = typeof chunk.message?.content === "string" && chunk.message.content
    ? chunk.message.content
    : undefined;
  const thinking = typeof chunk.message?.thinking === "string" && chunk.message.thinking
    ? chunk.message.thinking
    : undefined;
  const parsedTools = parseToolCalls(chunk.message?.tool_calls);
  const toolCalls = parsedTools.calls;
  const promptTokens = count(chunk.prompt_eval_count);
  const completionTokens = count(chunk.eval_count);
  const error = typeof chunk.error === "string" && chunk.error
    ? chunk.error
    : parsedTools.error;
  const done = chunk.done === true;
  const doneReason = typeof chunk.done_reason === "string" && chunk.done_reason
    ? chunk.done_reason
    : undefined;
  if (!text && !thinking && !toolCalls.length && promptTokens === undefined
    && completionTokens === undefined && !error && !done && !doneReason) return undefined;
  return {
    ...(text ? { text } : {}),
    ...(thinking ? { thinking } : {}),
    ...(toolCalls.length ? { toolCalls } : {}),
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens }),
    ...(error ? { error } : {}),
    ...(done ? { done: true } : {}),
    ...(doneReason ? { doneReason } : {}),
  };
}

function parseToolCalls(value: unknown): { calls: OllamaToolCallFragment[]; error?: string } {
  if (value === undefined) return { calls: [] };
  if (!Array.isArray(value)) {
    return { calls: [], error: "Ollama Cloud returned malformed tool calls" };
  }
  const calls: OllamaToolCallFragment[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isRecord(item.function)) {
      return { calls: [], error: "Ollama Cloud returned malformed tool calls" };
    }
    if (item.function.name !== undefined && typeof item.function.name !== "string") {
      return { calls: [], error: "Ollama Cloud returned malformed tool calls" };
    }
    if (item.function.arguments !== undefined
      && typeof item.function.arguments !== "string"
      && !isRecord(item.function.arguments)) {
      return { calls: [], error: "Ollama Cloud returned malformed tool calls" };
    }
    calls.push({
      ...(typeof item.id === "string" && item.id ? { id: item.id } : {}),
      ...(typeof item.function.index === "number" && Number.isInteger(item.function.index)
        && item.function.index >= 0 ? { index: item.function.index } : {}),
      function: {
        ...(typeof item.function.name === "string" && item.function.name
          ? { name: item.function.name } : {}),
        ...(item.function.arguments === undefined ? {} : { arguments: item.function.arguments }),
      },
    });
  }
  return { calls };
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasEventData(event: Omit<ParsedStreamEvent, "toolCalls">): boolean {
  return Boolean(event.text || event.thinking || event.promptTokens !== undefined
    || event.completionTokens !== undefined || event.error || event.done || event.doneReason);
}
