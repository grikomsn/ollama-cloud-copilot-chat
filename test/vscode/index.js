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
  const inferenceModel = registered.find((model) => model.id === result.model)
    ?? registered[0];
  const response = await inferenceModel.sendRequest(
    [vscode.LanguageModelChatMessage.User("Reply with exactly: usage verified")],
    {},
    new vscode.CancellationTokenSource().token,
  );
  const usageParts = [];
  for await (const part of response.stream) {
    if (part instanceof vscode.LanguageModelDataPart && part.mimeType === "usage") {
      usageParts.push(JSON.parse(new TextDecoder().decode(part.data)));
    }
  }
  assert.equal(usageParts.length, 1, "the provider emits exactly one usage part");
  assert.ok(usageParts[0].prompt_tokens > 0, "usage includes prompt tokens");
  assert.ok(usageParts[0].completion_tokens > 0, "usage includes completion tokens");

  const tool = {
    name: "ollama_cloud_editor_test_echo",
    description: "Return a supplied verification value for the editor integration test.",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "string", description: "The verification value to return." },
      },
      required: ["value"],
      additionalProperties: false,
    },
  };
  const toolResponse = await inferenceModel.sendRequest(
    [vscode.LanguageModelChatMessage.User(
      "Call ollama_cloud_editor_test_echo exactly once with value vscode-tool-verified. Then reply with exactly tool-result-verified. Do not answer until you call it.",
    )],
    {
      tools: [tool],
      toolMode: vscode.LanguageModelChatToolMode.Required,
    },
    new vscode.CancellationTokenSource().token,
  );
  const toolCalls = [];
  for await (const part of toolResponse.stream) {
    if (part instanceof vscode.LanguageModelToolCallPart) toolCalls.push(part);
  }
  console.log(JSON.stringify({ stage: "tool_request", toolCallCount: toolCalls.length }));
  assert.ok(toolCalls.length >= 1, "VS Code provider returned a native tool call");
  assert.equal(toolCalls[0].name, tool.name);
  assert.equal(toolCalls[0].input.value, "vscode-tool-verified");

  const minimaxModel = registered.find((model) => model.id === "minimax-m3");
  assert.ok(minimaxModel, "MiniMax M3 is registered for live parallel-tool validation");
  const parallelResponse = await minimaxModel.sendRequest(
    [vscode.LanguageModelChatMessage.User(
      "Call ollama_cloud_editor_test_echo exactly three times in parallel, once with each value: parallel-a, parallel-b, parallel-c. Do not write text.",
    )],
    {
      tools: [tool],
      toolMode: vscode.LanguageModelChatToolMode.Required,
    },
    new vscode.CancellationTokenSource().token,
  );
  const parallelCalls = [];
  for await (const part of parallelResponse.stream) {
    if (part instanceof vscode.LanguageModelToolCallPart) parallelCalls.push(part);
  }
  assert.equal(parallelCalls.length, 3, "MiniMax M3 returns three parallel tool calls");
  assert.deepEqual(
    parallelCalls.map((call) => call.input.value).sort(),
    ["parallel-a", "parallel-b", "parallel-c"],
  );
  console.log(JSON.stringify({
    stage: "minimax_parallel_tool_request",
    toolCallCount: parallelCalls.length,
  }));

  const followUpResponse = await inferenceModel.sendRequest(
    [
      vscode.LanguageModelChatMessage.User(
        "Call ollama_cloud_editor_test_echo exactly once with value vscode-tool-verified. Then reply with exactly tool-result-verified.",
      ),
      vscode.LanguageModelChatMessage.Assistant(toolCalls),
      vscode.LanguageModelChatMessage.User(toolCalls.map((call) =>
        new vscode.LanguageModelToolResultPart(call.callId, [
          new vscode.LanguageModelTextPart("tool-result-verified"),
        ]),
      )),
    ],
    { tools: [tool] },
    new vscode.CancellationTokenSource().token,
  );
  let followUpText = "";
  for await (const part of followUpResponse.stream) {
    if (part instanceof vscode.LanguageModelTextPart) followUpText += part.value;
  }
  console.log(JSON.stringify({ stage: "tool_follow_up", textCharacters: followUpText.length }));
  assert.match(followUpText, /tool-result-verified/);
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes("ollamaCloudCopilot.showUsage"));
  assert.ok(commands.includes("ollamaCloudCopilot.openUsage"));

  console.log(JSON.stringify({
    verified: true,
    modelCount: result.modelCount,
    inferenceModel: result.model,
    inferenceCharacters: result.text.length,
    registeredModelCount: registered.length,
    toolCallCount: toolCalls.length,
    followUpCharacters: followUpText.length,
    usageWindows: {
      session: result.sessionUsage,
      weekly: result.weeklyUsage,
    },
  }));
}

module.exports = { run };
