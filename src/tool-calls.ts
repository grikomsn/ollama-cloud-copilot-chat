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
  readonly order: number;
  readonly slot: number;
  id?: string;
  index?: number;
  name?: string;
  arguments?: Record<string, unknown>;
  argumentsText?: string;
}

export class ToolCallAccumulator {
  private readonly calls: PendingToolCall[] = [];
  private readonly byId = new Map<string, PendingToolCall>();
  private readonly byIndex = new Map<number, PendingToolCall>();
  private readonly bySlot = new Map<number, PendingToolCall>();
  private nextOrder = 0;
  private error?: string;

  add(fragments: readonly OllamaToolCallFragment[]): void {
    for (const [slot, fragment] of fragments.entries()) {
      const pending = this.findOrCreate(fragment, slot);
      if (fragment.function.name) pending.name = fragment.function.name;
      if (fragment.function.arguments !== undefined) {
        this.addArguments(pending, fragment.function.arguments);
      }
    }
  }

  finish(): ToolCallAccumulatorResult {
    const pending = [...this.calls].sort((left, right) => left.order - right.order);
    const error = this.error;
    this.reset();
    if (error) return { calls: [], error };
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

  private findOrCreate(fragment: OllamaToolCallFragment, slot: number): PendingToolCall {
    const byId = fragment.id ? this.byId.get(fragment.id) : undefined;
    const byIndex = fragment.index === undefined ? undefined : this.byIndex.get(fragment.index);
    const bySlot = this.bySlot.get(slot);
    const keyed = byId ?? byIndex;
    const hasIdentity = Boolean(fragment.id) || fragment.index !== undefined;
    const canUpgradeAnonymous = bySlot && !bySlot.id && bySlot.index === undefined;
    const slotCandidate = !hasIdentity || canUpgradeAnonymous ? bySlot : undefined;
    const existing = keyed ?? slotCandidate;
    if (byId && byIndex && byId !== byIndex) {
      this.error = "Ollama Cloud returned conflicting tool-call identities";
    }
    if (existing) {
      this.attachIdentity(existing, fragment);
      return existing;
    }
    const pending: PendingToolCall = {
      order: this.nextOrder++,
      slot,
    };
    this.calls.push(pending);
    this.bySlot.set(slot, pending);
    this.attachIdentity(pending, fragment);
    return pending;
  }

  private attachIdentity(pending: PendingToolCall, fragment: OllamaToolCallFragment): void {
    if (fragment.id) {
      if (pending.id && pending.id !== fragment.id) {
        this.error = "Ollama Cloud returned conflicting tool-call identities";
      } else {
        pending.id = fragment.id;
        this.byId.set(fragment.id, pending);
      }
    }
    if (fragment.index !== undefined) {
      if (pending.index !== undefined && pending.index !== fragment.index) {
        this.error = "Ollama Cloud returned conflicting tool-call identities";
      } else {
        pending.index = fragment.index;
        this.byIndex.set(fragment.index, pending);
      }
    }
    if (pending.name && fragment.function.name && pending.name !== fragment.function.name) {
      this.error = "Ollama Cloud returned ambiguous unkeyed tool call fragments";
    }
  }

  private reset(): void {
    this.calls.length = 0;
    this.byId.clear();
    this.byIndex.clear();
    this.bySlot.clear();
    this.error = undefined;
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
      }
      return;
    }
    pending.arguments = { ...pending.arguments, ...value };
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
