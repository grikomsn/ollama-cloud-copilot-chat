import assert from "node:assert/strict";
import test from "node:test";
import { CredentialCapabilities } from "./credential-capabilities";

test("issues opaque request capabilities that resolve only their originating credential", () => {
  const ids = ["capability-a", "capability-b"];
  const capabilities = new CredentialCapabilities(() => 1_000, () => ids.shift()!);
  const accountA = capabilities.issue("credential-a");
  const accountB = capabilities.issue("credential-b");
  assert.equal(capabilities.resolve(accountA), "credential-a");
  assert.equal(capabilities.resolve(accountB), "credential-b");
  assert.equal(capabilities.resolve("credential-b"), undefined);
  assert.equal(capabilities.resolve("unknown-capability"), undefined);
});

test("rejects expired request capabilities", () => {
  let now = 1_000;
  const capabilities = new CredentialCapabilities(() => now, () => "capability");
  const capability = capabilities.issue("credential");
  now += 10 * 60_000;
  assert.equal(capabilities.resolve(capability), undefined);
});
