// Ollama may split a single client-tool call across multiple NDJSON events.
// This state is transport parsing, not execution of the selected tool.
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
  private nextOrder = 0;
  private error?: string;

  add(fragments: readonly OllamaToolCallFragment[]): void {
    const existingCalls = [...this.calls];
    const keyedExistingThisEvent = new Set<PendingToolCall>();
    const complementaryMatches = new Map<OllamaToolCallFragment, PendingToolCall>();
    const matchCounts = new Map<PendingToolCall, number>();
    let hasUnmatchedKeyedFragment = false;
    for (const fragment of fragments) {
      if (isUnkeyed(fragment)) continue;
      const existing = this.findExistingCall(fragment, existingCalls, true);
      if (!existing) {
        hasUnmatchedKeyedFragment = true;
        continue;
      }
      keyedExistingThisEvent.add(existing);
      matchCounts.set(existing, (matchCounts.get(existing) ?? 0) + 1);
      const directlyMatched = (fragment.id !== undefined && fragment.id === existing.id)
        || (fragment.index !== undefined && fragment.index === existing.index);
      if (!directlyMatched) complementaryMatches.set(fragment, existing);
    }
    const allowedComplementaryFragments = new Set<OllamaToolCallFragment>();
    if (!hasUnmatchedKeyedFragment) {
      for (const [fragment, existing] of complementaryMatches) {
        if (matchCounts.get(existing) === 1) allowedComplementaryFragments.add(fragment);
      }
    }
    const unkeyedCount = fragments.filter((fragment) => isUnkeyed(fragment)).length;
    for (const fragment of fragments) {
      let pending: PendingToolCall | undefined;
      if (isUnkeyed(fragment)) {
        pending = this.findUnkeyedCall(
          existingCalls,
          unkeyedCount,
          keyedExistingThisEvent,
        );
        if (!pending) {
          if (existingCalls.length === 0) {
            pending = this.createPending();
          } else {
            this.error = "Ollama Cloud returned ambiguous unkeyed tool call fragments";
            continue;
          }
        }
      } else {
        pending = this.findOrCreate(
          fragment,
          existingCalls,
          allowedComplementaryFragments.has(fragment),
        );
      }
      this.applyFragment(pending, fragment);
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

  private findOrCreate(
    fragment: OllamaToolCallFragment,
    existingCalls: readonly PendingToolCall[],
    allowComplementaryIdentity: boolean,
  ): PendingToolCall {
    const byId = fragment.id ? this.byId.get(fragment.id) : undefined;
    const byIndex = fragment.index === undefined ? undefined : this.byIndex.get(fragment.index);
    if (byId && byIndex && byId !== byIndex) {
      this.error = "Ollama Cloud returned conflicting tool-call identities";
    }
    const existing = byId ?? byIndex ?? this.findComplementaryIdentityCandidate(
      fragment,
      existingCalls,
      allowComplementaryIdentity,
    );
    if (existing) {
      this.attachIdentity(existing, fragment);
      return existing;
    }
    if (this.calls.length > 1 && this.calls.some(isAnonymousPending)) {
      this.error = "Ollama Cloud returned ambiguous tool-call identities";
    }
    const pending = this.createPending();
    this.attachIdentity(pending, fragment);
    return pending;
  }

  private findComplementaryIdentityCandidate(
    fragment: OllamaToolCallFragment,
    candidateCalls: readonly PendingToolCall[],
    allowComplementaryIdentity: boolean,
  ): PendingToolCall | undefined {
    const candidates = candidateCalls.filter((call) => {
      if (isAnonymousPending(call)) return false;
      if (fragment.id && call.id && call.id !== fragment.id) return false;
      if (fragment.index !== undefined && call.index !== undefined && call.index !== fragment.index) {
        return false;
      }
      return true;
    });
    if (candidates.length > 1) {
      this.error = "Ollama Cloud returned ambiguous tool-call identities";
      return undefined;
    }
    if (candidates.length === 1 && !allowComplementaryIdentity) {
      this.error = "Ollama Cloud returned ambiguous tool-call identities";
      return undefined;
    }
    return candidates[0];
  }

  private findExistingCall(
    fragment: OllamaToolCallFragment,
    existingCalls: readonly PendingToolCall[],
    allowComplementaryIdentity: boolean,
  ): PendingToolCall | undefined {
    const byId = fragment.id
      ? existingCalls.find((call) => call.id === fragment.id)
      : undefined;
    const byIndex = fragment.index === undefined
      ? undefined
      : existingCalls.find((call) => call.index === fragment.index);
    if (byId && byIndex && byId !== byIndex) {
      this.error = "Ollama Cloud returned conflicting tool-call identities";
    }
    return byId ?? byIndex ?? this.findComplementaryIdentityCandidate(
      fragment,
      existingCalls,
      allowComplementaryIdentity,
    );
  }

  private findUnkeyedCall(
    existingCalls: readonly PendingToolCall[],
    unkeyedCount: number,
    keyedExistingThisEvent: ReadonlySet<PendingToolCall>,
  ): PendingToolCall | undefined {
    const available = existingCalls.filter((call) => (
      isAnonymousPending(call) && !keyedExistingThisEvent.has(call)
    ));
    if (unkeyedCount !== 1 || available.length !== 1) {
      return undefined;
    }
    return available[0];
  }

  private createPending(): PendingToolCall {
    const pending: PendingToolCall = {
      order: this.nextOrder++,
    };
    this.calls.push(pending);
    return pending;
  }

  private applyFragment(
    pending: PendingToolCall,
    fragment: OllamaToolCallFragment,
  ): void {
    if (pending.name && fragment.function.name && pending.name !== fragment.function.name) {
      this.error = "Ollama Cloud returned ambiguous unkeyed tool call fragments";
    } else if (fragment.function.name) {
      pending.name = fragment.function.name;
    }
    if (fragment.function.arguments !== undefined) {
      this.addArguments(pending, fragment.function.arguments);
    }
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

function isUnkeyed(fragment: OllamaToolCallFragment): boolean {
  return !fragment.id && fragment.index === undefined;
}

function isAnonymousPending(call: PendingToolCall): boolean {
  return call.id === undefined && call.index === undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
