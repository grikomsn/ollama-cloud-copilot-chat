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
    const entries = new NativeEntries(cache);
    const provider = new OllamaCloudProvider(entries, cache, { appendLine() {} }, "native-test");
    const prepare = async (entryId, apiKey) => (await provider.provideLanguageModelChatInformation({
      configuration: { entryId, apiKey, name: "Same name" }, silent: true,
    }, source.token))[0];
    const work = await prepare("work", "synthetic-work");
    const personal = await prepare("personal", "synthetic-personal");
    assert.notEqual(work.id, personal.id);
    assert.notEqual(work.credentialRef, personal.credentialRef);
    assert.equal(provider.getInlineApiKey(""), undefined);
    assert.equal(provider.getInlineApiKey("work"), "synthetic-work");
    assert.equal(provider.getInlineApiKey("missing"), undefined);
    const callsByEntry = [];
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
      callsByEntry.push(calls);
    }
    assert.equal(await provider.getApiKeyForCapability(callsByEntry[0][0].input.credential_capability), "synthetic-work");
    const history = [vscode.LanguageModelChatMessage.User("synthetic prompt"), vscode.LanguageModelChatMessage.Assistant(callsByEntry[0]),
      vscode.LanguageModelChatMessage.User(callsByEntry[0].map((call) => new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart("synthetic result")])) )];
    await provider.provideLanguageModelChatResponse(work, history, options, { report() {} }, source.token);
    assert.equal(sent.at(-1).body.messages.filter((message) => message.role === "tool").length, 3);
    provider.selectEntry("personal");
    await provider.refreshUsage();
    assert.equal(provider.getUsageSnapshot().weekly.usedRatio, 0.2);
    const rotated = await prepare("work", "synthetic-rotated");
    assert.equal(work.id, rotated.id);
    assert.notEqual(work.credentialRef, rotated.credentialRef);
    await assert.rejects(provider.provideLanguageModelChatResponse(work, [], options, { report() {} }, source.token), /replaced or removed/);
    assert.equal(await provider.getApiKeyForCapability(callsByEntry[0][0].input.credential_capability), undefined);
    assert.equal(provider.getInlineApiKey("work"), "synthetic-rotated");
    const returned = await prepare("work", "synthetic-work");
    assert.equal(work.id, returned.id);
    assert.equal(work.credentialRef, returned.credentialRef);
    assert.notEqual(work.entryGeneration, returned.entryGeneration);
    await assert.rejects(provider.provideLanguageModelChatResponse(work, [], options, { report() {} }, source.token), /replaced or removed/);
    assert.equal(await provider.getApiKeyForCapability(callsByEntry[0][0].input.credential_capability), undefined);
    const freshOutput = [];
    await provider.provideLanguageModelChatResponse(returned, [], options, { report: (part) => freshOutput.push(part) }, source.token);
    const freshCapability = freshOutput.find((part) => part instanceof vscode.LanguageModelToolCallPart).input.credential_capability;
    const shared = await prepare("shared", "synthetic-work");
    const sharedOutput = [];
    await provider.provideLanguageModelChatResponse(shared, [], options, { report: (part) => sharedOutput.push(part) }, source.token);
    const sharedCapability = sharedOutput.find((part) => part instanceof vscode.LanguageModelToolCallPart).input.credential_capability;
    let rediscovery;
    const changed = provider.onDidChangeLanguageModelChatInformation(() => { rediscovery = prepare("work", "synthetic-work"); });
    await provider.forgetEntry("work");
    assert.equal(await rediscovery, undefined);
    assert.equal(provider.getInlineApiKey("work"), undefined);
    assert.equal(provider.getInlineApiKey("personal"), "synthetic-personal");
    assert.deepEqual(provider.getForgottenEntries(), ["work"]);
    assert.equal(await provider.getApiKeyForCapability(freshCapability), undefined);
    assert.equal(await provider.getApiKeyForCapability(sharedCapability), "synthetic-work");
    await assert.rejects(provider.provideLanguageModelChatResponse(returned, [], options, { report() {} }, source.token), /replaced or removed/);
    const restartedEntries = new NativeEntries(cache);
    const restarted = new OllamaCloudProvider(restartedEntries, cache, { appendLine() {} }, "native-test");
    const restartPrepare = async () => (await restarted.provideLanguageModelChatInformation({ configuration: { entryId: "work", apiKey: "synthetic-work" }, silent: true }, source.token))[0];
    assert.equal(await restartPrepare(), undefined);
    assert.equal(restarted.getInlineApiKey("work"), undefined);
    assert.deepEqual(restarted.getForgottenEntries(), ["work"]);
    assert.deepEqual([...values].find(([key]) => key.includes("forgottenEntries"))[1], ["work"]);
    await restarted.restoreEntry("work");
    const restored = await restartPrepare();
    assert.equal(restored.id, work.id);
    assert.notEqual(restored.entryGeneration, returned.entryGeneration);
    await assert.rejects(restarted.provideLanguageModelChatResponse(returned, [], options, { report() {} }, source.token), /replaced or removed/);
    await restarted.provideLanguageModelChatResponse(restored, [], options, { report() {} }, source.token);
    await provider.restoreEntry("work");
    assert.ok(await rediscovery);
    assert.equal(await provider.getApiKeyForCapability(freshCapability), undefined);
    assert.equal(await provider.getApiKeyForCapability(sharedCapability), "synthetic-work");
    assert.equal(Object.keys(provider.getObservedEntries()).length, 3);
    changed.dispose();
    let discoveryStarted;
    let releaseDiscovery;
    const started = new Promise((resolve) => { discoveryStarted = resolve; });
    const gate = new Promise((resolve) => { releaseDiscovery = resolve; });
    const normalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/tags") && new Headers(init.headers).get("Authorization") === "Bearer synthetic-slow") {
        discoveryStarted();
        await gate;
      }
      return normalFetch(url, init);
    };
    try {
      const pendingDiscovery = prepare("slow", "synthetic-slow");
      await started;
      await provider.forgetEntry("slow");
      releaseDiscovery();
      assert.equal(await pendingDiscovery, undefined);
      assert.equal(provider.getObservedEntries().slow, undefined);
      assert.equal(provider.getInlineApiKey("slow"), undefined);
    } finally { releaseDiscovery(); globalThis.fetch = normalFetch; }
    assert.equal(new NativeEntries(cache).keyForEntry("personal"), undefined);
  } finally { globalThis.fetch = fetcher; source.dispose(); }
  console.log(JSON.stringify({ provider: "ollama", nativeChecks: "parallel tools, reasoning closure, two entries, bound capabilities, follow-up, explicit inline selection, rotation back, shared keys, forget/rediscovery, persisted tombstones, deliberate restore, stale generations after restart, forget during discovery", passed: true }));
}
module.exports = { run };
