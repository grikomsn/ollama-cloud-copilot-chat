import assert from "node:assert/strict";
import test from "node:test";
import { API_KEY_SECRET, credentialReference, OllamaCloudAuth, type SecretStore } from "./auth";

test("derives stable secret-safe credential references", () => {
  assert.equal(credentialReference(" key "), credentialReference("key"));
  assert.notEqual(credentialReference("key-one"), credentialReference("key-two"));
  assert.match(credentialReference("key"), /^[a-f0-9]{16}$/);
});

test("stores, trims, and clears API keys", async () => {
  const values = new Map<string, string>();
  const store: SecretStore = {
    get: async (key) => values.get(key),
    store: async (key, value) => void values.set(key, value),
    delete: async (key) => void values.delete(key),
  };
  const auth = new OllamaCloudAuth(store);

  await auth.storeApiKey("  secret  ");
  assert.equal(values.get(API_KEY_SECRET), "secret");
  assert.equal(await auth.getApiKey(), "secret");
  assert.equal(await auth.hasApiKey(), true);

  await auth.clearApiKey();
  assert.equal(await auth.hasApiKey(), false);
});

test("rejects an empty API key", async () => {
  const auth = new OllamaCloudAuth({
    get: async () => undefined,
    store: async () => undefined,
    delete: async () => undefined,
  });
  await assert.rejects(() => auth.storeApiKey(" \n "), /cannot be empty/);
});
