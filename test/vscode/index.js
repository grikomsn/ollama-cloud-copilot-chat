const assert = require("node:assert/strict");
const vscode = require("vscode");

async function run() {
  const extension = vscode.extensions.getExtension(
    "grikomsn.ollama-cloud-copilot-chat",
  );
  assert.ok(extension, "the Ollama Cloud extension is installed in the test host");

  const api = await extension.activate();
  assert.equal(typeof api?.smokeTestWithApiKey, "function");

  const result = await api.smokeTestWithApiKey(process.env.OLLAMA_API_KEY);
  assert.ok(result.modelCount >= 1, "the live cloud catalog contains models");
  assert.ok(result.model, "the smoke test selected a model");
  assert.ok(
    result.text.trim().length > 0,
    "live inference returned a non-empty model response",
  );
  assert.equal(
    typeof result.sessionUsage,
    "number",
    "the authenticated usage endpoint returned session usage",
  );
  assert.equal(
    typeof result.weeklyUsage,
    "number",
    "the authenticated usage endpoint returned weekly usage",
  );

  const registered = await vscode.lm.selectChatModels({
    vendor: "ollama-cloud",
  });
  assert.ok(registered.length >= 1, "VS Code can select registered Ollama Cloud models");
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes("ollamaCloudCopilot.showUsage"));
  assert.ok(commands.includes("ollamaCloudCopilot.openUsage"));

  console.log(JSON.stringify({
    verified: true,
    modelCount: result.modelCount,
    inferenceModel: result.model,
    inferenceCharacters: result.text.length,
    registeredModelCount: registered.length,
    usageWindows: {
      session: result.sessionUsage,
      weekly: result.weeklyUsage,
    },
  }));
}

module.exports = { run };
