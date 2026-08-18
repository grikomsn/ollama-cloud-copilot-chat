import * as vscode from "vscode";
import {
  createWebSearchRequestCancellation,
  formatOllamaWebSearch,
  searchOllamaWeb,
  type OllamaWebSearchInput,
} from "./web-search-client";

export class OllamaWebSearchTool implements vscode.LanguageModelTool<OllamaWebSearchInput> {
  constructor(private readonly resolveApiKey: () => Promise<string | undefined>) {}

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
    const apiKey = await this.resolveApiKey();
    if (!apiKey) {
      throw new Error("Select a configured Ollama Cloud model before using Ollama web search");
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
