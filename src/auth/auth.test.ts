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

test("shared credentials survive removing one entry and expire after the last removal", async () => {
  const entries = new NativeEntries();
  const first = entries.register({ entryId: "first", apiKey: " shared " });
  const second = entries.register({ entryId: "second", apiKey: "shared" });
  assert.equal(first.credentialRef, second.credentialRef);
  await entries.forget("first");
  assert.equal(entries.keyForCredential(first.credentialRef), "shared");
  await entries.forget("second");
  assert.equal(entries.keyForCredential(first.credentialRef), undefined);
  assert.deepEqual(entries.list(), []);
  assert.match(credentialReference("key"), /^[a-f0-9]{16}$/);
  assert.equal(new NativeEntries().keyForEntry("second"), undefined);
});

function memoryState() {
  const values = new Map<string, unknown>();
  return { values, state: { get: <T>(key: string) => values.get(key) as T | undefined,
    async update(key: string, value: unknown) { await new Promise((resolve) => setImmediate(resolve)); values.set(key, value); } } };
}

test("forget blocks automatic provisioning immediately and after restart until explicit restore", async () => {
  const { values, state } = memoryState();
  const entries = new NativeEntries(state);
  const config = { entryId: "work", apiKey: "synthetic-secret" };
  const first = entries.register(config);
  const forgetting = entries.forget("work");
  assert.throws(() => entries.register(config), /Restore Native Entry/);
  assert.equal(entries.matches(first.entryId, first.credentialRef, first.generation), false);
  await forgetting;
  assert.deepEqual([...values.values()], [["work"]]);
  const restarted = new NativeEntries(state);
  assert.throws(() => restarted.register(config), /Restore Native Entry/);
  assert.equal(restarted.keyForEntry("work"), undefined);
  await restarted.restore("work");
  assert.deepEqual([...values.values()], [[]]);
  const restored = restarted.register(config);
  assert.equal(restored.credentialRef, first.credentialRef);
  assert.notEqual(restored.generation, first.generation);
  assert.equal(restarted.matches(first.entryId, first.credentialRef, first.generation), false);
  assert.equal(restarted.matches(restored.entryId, restored.credentialRef, restored.generation), true);
});

test("repeated provisioning preserves a handle while rotation back revokes prior generations", () => {
  const entries = new NativeEntries();
  const first = entries.register({ entryId: "work", apiKey: "synthetic-first" });
  assert.deepEqual(entries.register({ entryId: "work", apiKey: "synthetic-first" }), first);
  const rotated = entries.register({ entryId: "work", apiKey: "synthetic-second" });
  const returned = entries.register({ entryId: "work", apiKey: "synthetic-first" });
  assert.equal(returned.credentialRef, first.credentialRef);
  assert.notEqual(returned.generation, first.generation);
  assert.equal(entries.matches(first.entryId, first.credentialRef, first.generation), false);
  assert.equal(entries.matches(rotated.entryId, rotated.credentialRef, rotated.generation), false);
  assert.equal(entries.matches(returned.entryId, returned.credentialRef, returned.generation), true);
});

test("a later forget wins over a restore waiting on persistence", async () => {
  const { values, state } = memoryState();
  const entries = new NativeEntries(state);
  entries.register({ entryId: "work", apiKey: "synthetic" });
  await entries.forget("work");
  let started!: () => void;
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const writing = new Promise<void>((resolve) => { started = resolve; });
  const original = state.update;
  state.update = async (key, value) => {
    if (Array.isArray(value) && !value.length) { started(); await wait; }
    await original(key, value);
  };
  const restoring = entries.restore("work");
  await writing;
  const forgetting = entries.forget("work");
  release();
  await Promise.all([restoring, forgetting]);
  assert.deepEqual(entries.forgottenEntries(), ["work"]);
  assert.deepEqual([...values.values()], [["work"]]);
  assert.throws(() => entries.register({ entryId: "work", apiKey: "synthetic" }), /Restore/);
});

test("concurrent tombstones preserve aliases and failed restoration stays blocked", async () => {
  const { values, state } = memoryState();
  const entries = new NativeEntries(state);
  await Promise.all([entries.forget("work"), entries.forget("personal")]);
  assert.deepEqual([...values.values()], [["personal", "work"]]);
  const original = state.update;
  state.update = async () => { throw new Error("synthetic write failure"); };
  await assert.rejects(entries.restore("work"), /write failure/);
  assert.equal(entries.isForgotten("work"), true);
  state.update = original;
  await entries.restore("work");
  assert.deepEqual(entries.forgottenEntries(), ["personal"]);
  assert.deepEqual([...values.values()], [["personal"]]);
});

test("persisted tombstones contain valid aliases only and never credentials or generations", async () => {
  const { values, state } = memoryState();
  const entries = new NativeEntries(state);
  entries.register({ entryId: "work", apiKey: "synthetic-private-key" });
  await entries.forget("work");
  const key = [...values.keys()][0];
  values.set(key, ["work", "invalid alias", { apiKey: "synthetic-private-key" }, 42]);
  const restarted = new NativeEntries(state);
  assert.deepEqual(restarted.forgottenEntries(), ["work"]);
  await restarted.forget("personal");
  assert.deepEqual(values.get(key), ["personal", "work"]);
});

test("a failed forget blocks access immediately and can be retried durably", async () => {
  const { values, state } = memoryState();
  const entries = new NativeEntries(state);
  entries.register({ entryId: "work", apiKey: "synthetic-private-key" });
  const original = state.update;
  state.update = async () => { throw new Error("synthetic write failure"); };
  await assert.rejects(entries.forget("work"), /block could not be saved/);
  assert.equal(entries.keyForEntry("work"), undefined);
  assert.throws(() => entries.register({ entryId: "work", apiKey: "synthetic-private-key" }), /Restore/);
  state.update = original;
  await entries.forget("work");
  assert.deepEqual([...values.values()], [["work"]]);
  assert.equal(new NativeEntries(state).isForgotten("work"), true);
});
