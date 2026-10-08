import assert from "node:assert/strict";
import test from "node:test";
import { credentialReference, nativeEntryId, NativeEntries } from "./auth";

test("requires explicit distinct IDs rather than slugged display names", () => {
  assert.equal(nativeEntryId({ entryId: "work.a", name: "A B" }), "work.a");
  assert.equal(nativeEntryId({ entryId: "work-b", name: "A-B" }), "work-b");
  for (const entryId of [undefined, "A B", "A-B", "", "x".repeat(65)]) assert.throws(() => nativeEntryId({ entryId }));
});

test("rotation preserves entry selection and revokes old credentials without switching other entries", () => {
  const entries = new NativeEntries();
  const first = entries.register({ entryId: "work", apiKey: "synthetic-first" });
  entries.register({ entryId: "personal", apiKey: "synthetic-personal" });
  const rotated = entries.register({ entryId: "work", apiKey: "synthetic-rotated" });
  assert.equal(first.entryId, rotated.entryId);
  assert.notEqual(first.credentialRef, rotated.credentialRef);
  assert.equal(entries.keyForCredential(first.credentialRef), undefined);
  assert.equal(entries.keyForEntry("work"), "synthetic-rotated");
  assert.equal(entries.keyForEntry("personal"), "synthetic-personal");
  assert.equal(entries.keyForEntry("missing"), undefined);
  assert.throws(() => entries.register({ entryId: "work", apiKey: "" }));
  assert.equal(entries.keyForEntry("work"), "synthetic-rotated");
});

test("shared credentials survive removing one entry and expire after the last removal", () => {
  const entries = new NativeEntries();
  const first = entries.register({ entryId: "first", apiKey: " shared " });
  const second = entries.register({ entryId: "second", apiKey: "shared" });
  assert.equal(first.credentialRef, second.credentialRef);
  entries.forget("first");
  assert.equal(entries.keyForCredential(first.credentialRef), "shared");
  entries.forget("second");
  assert.equal(entries.keyForCredential(first.credentialRef), undefined);
  assert.deepEqual(entries.list(), []);
  assert.match(credentialReference("key"), /^[a-f0-9]{16}$/);
  assert.equal(new NativeEntries().keyForEntry("second"), undefined);
});
