export interface OllamaToolCallFragment {
  readonly id?: string;
  readonly index?: number;
  readonly function: {
    readonly name?: string;
    readonly arguments?: Record<string, unknown> | string;
  };
}

export interface OllamaToolCall {
  readonly id?: string;
  readonly index?: number;
  readonly function: {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  };
}

export interface ToolCallAccumulatorResult {
  readonly calls: OllamaToolCall[];
  readonly error?: string;
}

interface PendingToolCall {
  readonly key: string;
  readonly order: number;
  readonly id?: string;
  readonly index?: number;
  name?: string;
  arguments?: Record<string, unknown>;
  argumentsText?: string;
  argumentsComplete: boolean;
}

export class ToolCallAccumulator {
  private readonly calls = new Map<string, PendingToolCall>();
  private nextOrder = 0;

  add(fragments: readonly OllamaToolCallFragment[]): void {
    for (const fragment of fragments) {
      const pending = this.findOrCreate(fragment);
      if (fragment.function.name) pending.name = fragment.function.name;
      if (fragment.function.arguments !== undefined) {
        this.addArguments(pending, fragment.function.arguments);
      }
    }
  }

  finish(): ToolCallAccumulatorResult {
    const pending = [...this.calls.values()].sort((left, right) => left.order - right.order);
    this.calls.clear();
    const calls: OllamaToolCall[] = [];
    for (const call of pending) {
      if (!call.name) return { calls: [], error: "Ollama Cloud returned a tool call without a name" };
      const args = call.arguments ?? parseArguments(call.argumentsText);
      if (!args) {
        return { calls: [], error: `Ollama Cloud returned invalid arguments for tool ${call.name}` };
      }
      calls.push({
        ...(call.id ? { id: call.id } : {}),
        ...(call.index === undefined ? {} : { index: call.index }),
        function: { name: call.name, arguments: args },
      });
    }
    return { calls };
  }

  private findOrCreate(fragment: OllamaToolCallFragment): PendingToolCall {
    const key = fragment.id
      ? `id:${fragment.id}`
      : fragment.index === undefined
        ? this.findAnonymousKey()
        : `index:${fragment.index}`;
    const existing = this.calls.get(key);
    if (existing) return existing;
    const pending: PendingToolCall = {
      key,
      order: this.nextOrder++,
      ...(fragment.id ? { id: fragment.id } : {}),
      ...(fragment.index === undefined ? {} : { index: fragment.index }),
      argumentsComplete: false,
    };
    this.calls.set(key, pending);
    return pending;
  }

  private findAnonymousKey(): string {
    const pending = [...this.calls.values()]
      .filter((call) => call.key.startsWith("anonymous:") && !call.argumentsComplete)
      .sort((left, right) => right.order - left.order)[0];
    return pending?.key ?? `anonymous:${this.nextOrder}`;
  }

  private addArguments(
    pending: PendingToolCall,
    value: Record<string, unknown> | string,
  ): void {
    if (typeof value === "string") {
      pending.argumentsText = `${pending.argumentsText ?? ""}${value}`;
      const parsed = parseArguments(pending.argumentsText);
      if (parsed) {
        pending.arguments = parsed;
        pending.argumentsComplete = true;
      } else {
        pending.argumentsComplete = false;
      }
      return;
    }
    pending.arguments = { ...pending.arguments, ...value };
    pending.argumentsComplete = true;
  }
}

function parseArguments(value: string | undefined): Record<string, unknown> | undefined {
  if (value === undefined || value === "") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
