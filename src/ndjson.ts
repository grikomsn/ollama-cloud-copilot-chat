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

function parseToolCalls(value: unknown): { calls: OllamaToolCall[]; error?: string } {
  if (value === undefined) return { calls: [] };
  if (!Array.isArray(value)) {
    return { calls: [], error: "Ollama Cloud returned malformed tool calls" };
  }
  const calls: OllamaToolCall[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isRecord(item.function) || typeof item.function.name !== "string") {
      return { calls: [], error: "Ollama Cloud returned malformed tool calls" };
    }
    const args = parseArguments(item.function.arguments);
    if (!args) {
      return { calls: [], error: `Ollama Cloud returned invalid arguments for tool ${item.function.name}` };
    }
    calls.push({
      ...(typeof item.id === "string" && item.id ? { id: item.id } : {}),
      function: { name: item.function.name, arguments: args },
    });
  }
  return { calls };
}

function parseArguments(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (value === undefined || value === "") return {};
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
