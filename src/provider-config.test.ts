import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("declares native API-key configuration without a management-command override", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    contributes: { languageModelChatProviders: Array<Record<string, unknown>> };
  };
  const provider = manifest.contributes.languageModelChatProviders.find((item) => item.vendor === "ollama-cloud");
  assert.ok(provider);
  assert.equal(provider.managementCommand, undefined);
  assert.deepEqual((provider.configuration as { required?: string[] }).required, ["apiKey"]);
});


test("keeps management commands without entry selection or command-managed keys", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const commands = manifest.contributes.commands.map((item: { command: string }) => item.command);
  assert.ok(commands.includes("ollamaCloudCopilot.manage"));
  assert.ok(commands.includes("ollamaCloudCopilot.testConnection"));
  assert.ok(!commands.includes("ollamaCloudCopilot.selectEntry"));
  assert.ok(!commands.includes("ollamaCloudCopilot.forgetEntry"));
  assert.ok(!commands.includes("ollamaCloudCopilot.restoreEntry"));
  assert.ok(!commands.includes("ollamaCloudCopilot.configureApiKey"));
  const properties = manifest.contributes.configuration.properties;
  assert.equal(properties["ollamaCloudCopilot.managementEntry"], undefined);
  assert.equal(properties["ollamaCloudCopilot.inlineSuggestionsEntry"], undefined);
});
