# Development

## Prerequisites

- Node.js 22 or newer
- npm
- VS Code 1.125 or newer
- An ignored `.env` with `OLLAMA_API_KEY` for optional live protocol checks

## Validate

```bash
npm ci
npm test
npm run test:vscode
npm run package
npx vsce ls
```

The tests compile strict TypeScript and use Node's built-in test runner. Network
paths use injected fetch fakes; the normal test suite never reads `.env` or
calls Ollama Cloud. `npm run test:vscode` is the explicit live smoke test: it
reads `OLLAMA_API_KEY` from the process environment, launches an isolated VS
Code test host, discovers the current catalog, performs one small inference,
loads authenticated request activity or quota windows, and checks native response parts, parallel tools, follow-up history, and usage commands in the extension host. It does not save the key. Set `VSCODE_EXECUTABLE_PATH` to use an installed VS Code binary.

## Extension Development Host

1. Open this repository in VS Code.
2. Press F5 and choose **Run Extension**.
3. In the new window, open **Manage Language Models** and add an Ollama Cloud entry with an `entryId` and secret API key.
4. Run **Ollama Cloud: Test Inference**.
5. Open Copilot Chat and confirm the Ollama Cloud model group appears.
6. Check a vision model accepts an image.
7. Check a thinking model exposes the expected effort submenu and renders a
   thinking part separately.
8. Use agent mode to verify a model emits and completes a tool call.
9. Confirm the status bar matches <https://ollama.com/settings> and opens the
   subscription usage picker.
10. Inspect diagnostics and logs for accidental sensitive output.

## Release

Add a Changeset for user-visible work:

```bash
npm run changeset
```

Merging to `main` updates or creates a version pull request. After the version
pull request merges, release automation validates the project, publishes the
VSIX to the Marketplace, and creates a GitHub release.

## Implementation references

Initial provider research referenced Ollama's official
[`ollama-vscode`](https://github.com/ollama/ollama-vscode),
[`Ollama-Cloud-for-Copilot`](https://github.com/zelosleone/Ollama-Cloud-for-Copilot),
the [Ollama API documentation](https://docs.ollama.com/llms-full.txt), and
VS Code's
[Language Model Chat Provider guide](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider).

## Native contract checks

After `npm run compile`, launch VS Code with this repository as the extension development path and `test/native/index.js` as the extension tests path. These checks use real VS Code response constructors with injected synthetic credentials and HTTP responses. They cover parallel calls, credential routing, and failure paths without accessing live accounts. Live chat and account checks remain separate.
