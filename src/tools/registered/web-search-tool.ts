import * as vscode from "vscode";
import {
  createWebSearchRequestCancellation,
  formatOllamaWebSearch,
  searchOllamaWeb,
  type OllamaWebSearchInput,
} from "./web-search-client";

export class OllamaWebSearchTool implements vscode.LanguageModelTool<OllamaWebSearchInput> {
  constructor(private readonly resolveApiKey: (credentialRef: string) => Promise<string | undefined>) {}

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<OllamaWebSearchInput>,
    _token: vscode.CancellationToken,
  ): vscode.PreparedToolInvocation {
    return { invocationMessage: `Searching the web for “${options.input.query}”…` };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<OllamaWebSearchInput>,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const credentialRef = options.input.credential_ref;
    if (!credentialRef) throw new Error("The selected Ollama Cloud model did not bind an API-key reference to web search");
    const apiKey = await this.resolveApiKey(credentialRef);
    if (!apiKey) {
      throw new Error("The API key bound to this Ollama Cloud model is no longer available");
    }

    const { controller, cancellation } = createWebSearchRequestCancellation(token);
    try {
      const query = options.input.query.trim();
      const response = await searchOllamaWeb(
        options.input,
        apiKey,
        controller.signal,
      );
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(formatOllamaWebSearch(query, response)),
      ]);
    } finally {
      cancellation.dispose();
    }
  }
}
