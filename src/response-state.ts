import type { OllamaStreamEvent } from "./ndjson";

export interface ResponseStreamState {
  sawDone: boolean;
  sawAnswer: boolean;
  sawToolCall: boolean;
  outputLimited: boolean;
  thinkingOpen: boolean;
  toolCallIndex: number;
  readonly requestId: string;
}

export function createResponseStreamState(requestId: string): ResponseStreamState {
  return {
    sawDone: false,
    sawAnswer: false,
    sawToolCall: false,
    outputLimited: false,
    thinkingOpen: false,
    toolCallIndex: 0,
    requestId,
  };
}

export function observeResponseEvent(
  modelId: string,
  event: OllamaStreamEvent,
  state: ResponseStreamState,
): { readonly closeThinking: boolean; readonly outputLimited: boolean } {
  if (event.error) throw new Error(`Ollama Cloud stream failed for ${modelId}: ${event.error}`);
  if (event.thinking) state.thinkingOpen = true;
  const closeThinking = state.thinkingOpen
    && Boolean(event.text || event.toolCalls?.length || event.done);
  if (event.text) state.sawAnswer = true;
  if (event.toolCalls?.length) {
    state.sawAnswer = true;
    state.sawToolCall = true;
  }
  if (event.done) {
    state.sawDone = true;
  }
  if (event.doneReason === "length") state.outputLimited = true;
  return { closeThinking, outputLimited: state.outputLimited };
}

export function validateResponseCompletion(
  modelId: string,
  state: Readonly<ResponseStreamState>,
  requiresToolCall: boolean,
): void {
  if (!state.sawDone) {
    throw new Error(`Ollama Cloud stream ended before ${modelId} reported completion`);
  }
  if (requiresToolCall && !state.sawToolCall) {
    throw new Error(`${modelId} completed without the required tool call`);
  }
  if (!state.sawAnswer) {
    throw new Error(`${modelId} completed without returning an answer or tool call`);
  }
}

export function toolCallId(
  upstreamId: string | undefined,
  state: ResponseStreamState,
): string {
  if (upstreamId) return upstreamId;
  return `ollama-cloud-${state.requestId}-${state.toolCallIndex++}`;
}
