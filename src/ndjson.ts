export interface OllamaToolCall {
  readonly id?: string;
  readonly function: {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  };
}

export interface OllamaStreamEvent {
  readonly text?: string;
  readonly thinking?: string;
  readonly toolCalls?: readonly OllamaToolCall[];
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly error?: string;
  readonly done?: boolean;
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
}

export class NdjsonStreamParser {
  private buffer = "";

  push(chunk: string): OllamaStreamEvent[] {
    this.buffer += chunk;
    const events: OllamaStreamEvent[] = [];
    let boundary: number;
    while ((boundary = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, boundary).trim();
      this.buffer = this.buffer.slice(boundary + 1);
      const event = parseLine(line);
      if (event) events.push(event);
    }
    return events;
  }

  finish(): OllamaStreamEvent[] {
    const line = this.buffer.trim();
    this.buffer = "";
    const event = parseLine(line);
    return event ? [event] : [];
  }
}

function parseLine(line: string): OllamaStreamEvent | undefined {
  if (!line) return undefined;
  let chunk: NativeChunk;
  try {
    chunk = JSON.parse(line) as NativeChunk;
  } catch {
    return undefined;
  }
  const text = typeof chunk.message?.content === "string" && chunk.message.content
    ? chunk.message.content
    : undefined;
  const thinking = typeof chunk.message?.thinking === "string" && chunk.message.thinking
    ? chunk.message.thinking
    : undefined;
  const toolCalls = parseToolCalls(chunk.message?.tool_calls);
  const promptTokens = count(chunk.prompt_eval_count);
  const completionTokens = count(chunk.eval_count);
  const error = typeof chunk.error === "string" && chunk.error ? chunk.error : undefined;
  const done = chunk.done === true;
  if (!text && !thinking && !toolCalls.length && promptTokens === undefined
    && completionTokens === undefined && !error && !done) return undefined;
  return {
    ...(text ? { text } : {}),
    ...(thinking ? { thinking } : {}),
    ...(toolCalls.length ? { toolCalls } : {}),
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens }),
    ...(error ? { error } : {}),
    ...(done ? { done: true } : {}),
  };
}

function parseToolCalls(value: unknown): OllamaToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || !isRecord(item.function) || typeof item.function.name !== "string") return [];
    const args = parseArguments(item.function.arguments);
    return [{
      ...(typeof item.id === "string" && item.id ? { id: item.id } : {}),
      function: { name: item.function.name, arguments: args },
    }];
  });
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
