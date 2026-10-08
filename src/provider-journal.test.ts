import assert from "node:assert/strict";
import test from "node:test";
import { observeEntry, observedEntries } from "./provider-journal";
import type { CatalogCache } from "./models/catalog";

test("concurrent observations and removals preserve other entries without persisting credentials", async () => {
  const values = new Map<string, unknown>();
  const state: CatalogCache = { get: <T>(key: string) => values.get(key) as T | undefined,
    async update(key, value) { await new Promise((resolve) => setImmediate(resolve)); values.set(key, value); } };
  await Promise.all([observeEntry(state, "work", 2), observeEntry(state, "personal", 3)]);
  assert.deepEqual(Object.keys(observedEntries(state)).sort(), ["personal", "work"]);
  assert.deepEqual(Object.keys(observedEntries(state).work).sort(), ["modelCount", "updatedAt"]);
  await Promise.all([observeEntry(state, "work", undefined), observeEntry(state, "new", 4)]);
  assert.deepEqual(Object.keys(observedEntries(state)).sort(), ["new", "personal"]);
});
