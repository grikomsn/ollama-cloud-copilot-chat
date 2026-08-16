import assert from "node:assert/strict";
import test from "node:test";
import { readOllamaNdjsonStream } from "./ndjson-stream";

test("decodes all events and reports stream activity", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{"message":{"content":"hi"}}\n'));
      controller.enqueue(encoder.encode('{"done":true,"done_reason":"stop"}\n'));
      controller.close();
    },
  });
  const events: unknown[] = [];
  let activity = 0;
  const completed = await readOllamaNdjsonStream(
    body,
    { isCancellationRequested: false },
    (event) => events.push(event),
    () => activity++,
  );
  assert.equal(completed, true);
  assert.equal(activity, 2);
  assert.equal(events.length, 2);
});

test("cancels the reader before consuming data", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() { cancelled = true; },
  });
  const completed = await readOllamaNdjsonStream(
    body,
    { isCancellationRequested: true },
    () => assert.fail("unexpected event"),
    () => assert.fail("unexpected activity"),
  );
  assert.equal(completed, false);
  assert.equal(cancelled, true);
});
