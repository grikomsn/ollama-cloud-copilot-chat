import assert from "node:assert/strict";
import test from "node:test";
import { apiKeyFromConfiguration, credentialReference, NativeEntries } from "./auth";

test("extracts a trimmed API key from entry configuration", () => {
  assert.equal(apiKeyFromConfiguration({ apiKey: "  synthetic-key  " }), "synthetic-key");
  assert.equal(apiKeyFromConfiguration({ apiKey: "   " }), undefined);
  assert.equal(apiKeyFromConfiguration({}), undefined);
});

test("credentials register once per distinct key and share fingerprints", () => {
  const entries = new NativeEntries();
  const first = entries.register("synthetic-a");
  const second = entries.register("synthetic-b");
  const shared = entries.register(" shared ");
  const sameShared = entries.register("shared");
  assert.notEqual(first, second);
  assert.equal(shared, sameShared);
  assert.equal(entries.keyForCredential(shared), "shared");
  assert.match(shared, /^[a-f0-9]{16}$/);
  assert.match(credentialReference("key"), /^[a-f0-9]{16}$/);
});

test("has and keyForCredential resolve only provisioned keys", () => {
  const entries = new NativeEntries();
  const ref = entries.register("synthetic-a");
  assert.equal(entries.has(ref), true);
  assert.equal(entries.has("deadbeef"), false);
  assert.equal(entries.keyForCredential("deadbeef"), undefined);
});

test("activeApiKey prefers the most recently provisioned key", async () => {
  const entries = new NativeEntries();
  assert.equal(entries.activeApiKey(), undefined);
  entries.register("synthetic-a");
  await new Promise((resolve) => setTimeout(resolve, 5));
  entries.register("synthetic-b");
  assert.equal(entries.activeApiKey(), "synthetic-b");
});
