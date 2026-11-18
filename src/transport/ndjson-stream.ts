import { readTextStream } from "../kit/stream";
import { NdjsonStreamParser, type OllamaStreamEvent } from "./ndjson";

export interface StreamCancellation {
  readonly isCancellationRequested: boolean;
}

/** Decodes a native Ollama NDJSON body; returns false when cancellation stopped it early. */
export async function readOllamaNdjsonStream(
  body: ReadableStream<Uint8Array>,
  cancellation: StreamCancellation,
  onEvent: (event: OllamaStreamEvent) => void,
  onActivity: () => void,
): Promise<boolean> {
  const parser = new NdjsonStreamParser();
  const completed = await readTextStream(body, (text) => {
    onActivity();
    for (const event of parser.push(text)) onEvent(event);
  }, { isCancelled: () => cancellation.isCancellationRequested });
  if (!completed) return false;
  for (const event of parser.finish()) onEvent(event);
  return true;
}
