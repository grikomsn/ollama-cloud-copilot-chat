import assert from "node:assert/strict";
import test from "node:test";
import { CredentialCapabilities } from "./credential-capabilities";

test("issues opaque request capabilities that resolve only their originating credential", () => {
  const ids = ["capability-a", "capability-b"];
  const capabilities = new CredentialCapabilities(() => 1_000, () => ids.shift()!);
  const bindingA = { entryId: "a", credentialRef: "credential-a", generation: "generation-a" };
  const accountA = capabilities.issue(bindingA);
  const bindingB = { entryId: "b", credentialRef: "credential-b", generation: "generation-b" };
  const accountB = capabilities.issue(bindingB);
  assert.deepEqual(capabilities.resolve(accountA), bindingA);
  assert.deepEqual(capabilities.resolve(accountB), bindingB);
  assert.equal(capabilities.resolve("credential-b"), undefined);
  assert.equal(capabilities.resolve("unknown-capability"), undefined);
});

test("rejects expired request capabilities", () => {
  let now = 1_000;
  const capabilities = new CredentialCapabilities(() => now, () => "capability");
  const capability = capabilities.issue({ entryId: "entry", credentialRef: "credential", generation: "generation" });
  now += 10 * 60_000;
  assert.equal(capabilities.resolve(capability), undefined);
});

test("capabilities retain immutable entry and generation bindings even when keys are shared", () => {
  let index = 0;
  const capabilities = new CredentialCapabilities(() => 1000, () => `capability-${index++}`);
  const first = { entryId: "first", credentialRef: "shared", generation: "first-generation" };
  const second = { entryId: "second", credentialRef: "shared", generation: "second-generation" };
  const firstCapability = capabilities.issue(first);
  const secondCapability = capabilities.issue(second);
  first.generation = "mutated";
  const resolved = capabilities.resolve(firstCapability)! as { generation: string };
  assert.equal(resolved.generation, "first-generation");
  resolved.generation = "mutated-again";
  assert.equal(capabilities.resolve(firstCapability)?.generation, "first-generation");
  assert.deepEqual(capabilities.resolve(secondCapability), second);
});
