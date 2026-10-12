const assert = require("node:assert/strict");
const vscode = require("vscode");
const { NativeEntries } = require("../../out/auth/auth");
const { OllamaCloudProvider } = require("../../out/provider");
const { OLLAMA_WEB_SEARCH_TOOL_NAME } = require("../../out/tools/registered/web-search");

async function run() {
  const source = new vscode.CancellationTokenSource();
  const fetcher = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("models.dev")) return Response.json({});
    if (String(url).endsWith("/tags")) return Response.json({ models: [{ name: "gpt-oss:20b" }] });
    if (String(url).endsWith("/show")) return Response.json({ capabilities: ["completion", "tools", "thinking"], model_info: { "gptoss.context_length": 131072 } });
    if (String(url).endsWith("/usage")) return Response.json({ limits: { session: { usage: 0.1 }, weekly: { usage: 0.2 } } });
    const body = JSON.parse(init.body);
    sent.push({ body, token: new Headers(init.headers).get("Authorization") });
    const followUp = body.messages.some((message) => message.role === "tool");
    const name = body.tools?.[0]?.function.name ?? "probe";
    return new Response([
      { message: { thinking: "synthetic plan" } },
      followUp ? { message: { content: "synthetic final answer" } } : { message: { tool_calls: [0, 1, 2].map((index) => ({ id: `call-${index}`, index, function: { name, arguments: { query: `synthetic-${index}` } } })) } },
      { done: true, done_reason: "stop", prompt_eval_count: 10, eval_count: 5 },
    ].map((event) => JSON.stringify(event)).join("\n"));
  };
  try {
    const values = new Map();
    const cache = { get: (key) => values.get(key), update: async (key, value) => { values.set(key, value); } };
    const entries = new NativeEntries();
    const provider = new OllamaCloudProvider(entries, cache, { appendLine() {} }, "native-test");
    const prepare = async (apiKey) => (await provider.provideLanguageModelChatInformation({
      configuration: { apiKey }, silent: true,
    }, source.token));
    const work = (await prepare("synthetic-work"))[0];
    const personal = (await prepare("synthetic-personal"))[0];
    assert.equal(work.id, personal.id, "VS Code namespaces raw model IDs per entry group");
    assert.equal(work.id, work.rawModelId);
    assert.notEqual(work.credentialRef, personal.credentialRef);
    assert.equal(provider.getFeatureApiKey(), "synthetic-personal", "Active key follows the most recent provisioning");
    const callsByKey = new Map();
    const options = { requestInitiator: "native-test", tools: [{ name: OLLAMA_WEB_SEARCH_TOOL_NAME, description: "Synthetic web probe", inputSchema: { type: "object" } }] };
    for (const [model, key] of [[work, "synthetic-work"], [personal, "synthetic-personal"]]) {
      const output = [];
      await provider.provideLanguageModelChatResponse(model, [vscode.LanguageModelChatMessage.User("synthetic prompt")], options, { report: (part) => output.push(part) }, source.token);
      const calls = output.filter((part) => part instanceof vscode.LanguageModelToolCallPart);
      assert.equal(calls.length, 3);
      assert.equal(new Set(calls.map((part) => part.callId)).size, 3);
      assert.equal(output[1].metadata.vscode_reasoning_done, true);
      assert.equal(sent.at(-1).token, `Bearer ${key}`);
      assert.equal(await provider.getApiKeyForCapability(calls[0].input.credential_capability), key);
      callsByKey.set(key, calls);
    }
    const history = [vscode.LanguageModelChatMessage.User("synthetic prompt"), vscode.LanguageModelChatMessage.Assistant(callsByKey.get("synthetic-work")),
      vscode.LanguageModelChatMessage.User(callsByKey.get("synthetic-work").map((call) => new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart("synthetic result")])))];
    await provider.provideLanguageModelChatResponse(work, history, options, { report() {} }, source.token);
    assert.equal(sent.at(-1).body.messages.filter((message) => message.role === "tool").length, 3);
    await provider.refreshUsage(personal.credentialRef);
    assert.equal(provider.getUsageSnapshot().weekly.usedRatio, 0.2);
    // Key-scoped credentials keep handles valid while their key stays provisioned.
    const shared = (await prepare("synthetic-work"))[0];
    assert.equal(shared.id, work.id);
    assert.equal(shared.credentialRef, work.credentialRef);
    const sharedOutput = [];
    await provider.provideLanguageModelChatResponse(shared, [], options, { report: (part) => sharedOutput.push(part) }, source.token);
    const sharedCapability = sharedOutput.find((part) => part instanceof vscode.LanguageModelToolCallPart).input.credential_capability;
    assert.equal(await provider.getApiKeyForCapability(sharedCapability), "synthetic-work");
    assert.equal(new NativeEntries().keyForCredential(work.credentialRef), undefined);
  } finally { globalThis.fetch = fetcher; source.dispose(); }
  console.log(JSON.stringify({ provider: "ollama", nativeChecks: "parallel tools, reasoning closure, two entries, bound capabilities, follow-up, active-key selection, raw ids, key-scoped handles", passed: true }));
}
module.exports = { run };
