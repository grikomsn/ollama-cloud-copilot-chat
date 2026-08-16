import { NdjsonStreamParser, type OllamaStreamEvent } from "./ndjson";

export interface StreamCancellation {
  readonly isCancellationRequested: boolean;
}

export async function readOllamaNdjsonStream(
  body: ReadableStream<Uint8Array>,
  cancellation: StreamCancellation,
  onEvent: (event: OllamaStreamEvent) => void,
  onActivity: () => void,
): Promise<boolean> {
  const parser = new NdjsonStreamParser();
  const reader = body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    if (cancellation.isCancellationRequested) {
      await reader.cancel();
      return false;
    }
    const chunk = await reader.read();
    if (chunk.done) break;
    onActivity();
    for (const event of parser.push(decoder.decode(chunk.value, { stream: true }))) {
      onEvent(event);
    }
  }
  for (const event of parser.push(decoder.decode())) onEvent(event);
  for (const event of parser.finish()) onEvent(event);
  return true;
}
