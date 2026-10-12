import * as vscode from "vscode";
import {
  fetchOllamaWeb,
  formatOllamaWebFetch,
  type OllamaWebFetchInput,
} from "./web-fetch-client";
import { createWebSearchRequestCancellation } from "./web-search-client";
import type { WebResultCache } from "./web-cache";

// This is an extension-registered VS Code tool, mirroring OllamaWebSearchTool.
// It calls Ollama's web-fetch endpoint when VS Code invokes it; it is not an
// Ollama chat hosted tool.
export class OllamaWebFetchTool implements vscode.LanguageModelTool<OllamaWebFetchInput> {
  constructor(
    private readonly resolveApiKey: (capability: string) => Promise<string | undefined>,
    private readonly cache?: WebResultCache,
  ) {}

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<OllamaWebFetchInput>,
    _token: vscode.CancellationToken,
  ): vscode.PreparedToolInvocation {
    return { invocationMessage: `Fetching “${options.input.url}”…` };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<OllamaWebFetchInput>,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const capability = options.input.credential_capability;
    if (!capability) throw new Error("The selected Ollama Cloud model did not bind a credential capability to web fetch");
    const apiKey = await this.resolveApiKey(capability);
    if (!apiKey) {
      throw new Error("The API key bound to this Ollama Cloud model is no longer available");
    }

    const { controller, cancellation } = createWebSearchRequestCancellation(token);
    try {
      const response = await fetchOllamaWeb(
        options.input,
        apiKey,
        controller.signal,
        undefined,
        this.cache,
      );
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(formatOllamaWebFetch(options.input, response)),
      ]);
    } finally {
      cancellation.dispose();
    }
  }
}
