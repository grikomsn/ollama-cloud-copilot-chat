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
  assert.deepEqual((provider.configuration as { required?: string[] }).required, ["apiKey", "entryId"]);
});


test("exposes deliberate native entry selection without command-managed key ownership", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const commands = manifest.contributes.commands.map((item: { command: string }) => item.command);
  assert.ok(commands.includes("ollamaCloudCopilot.selectEntry"));
  assert.ok(commands.includes("ollamaCloudCopilot.selectInlineEntry"));
  assert.ok(!commands.includes("ollamaCloudCopilot.configureApiKey"));
  for (const setting of ["managementEntry", "inlineSuggestionsEntry"]) {
    assert.equal(manifest.contributes.configuration.properties[`ollamaCloudCopilot.${setting}`].default, "");
  }
});
