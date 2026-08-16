import * as vscode from "vscode";
import { OllamaCloudAuth } from "./auth";
import {
  createWebSearchRequestCancellation,
  formatOllamaWebSearch,
  searchOllamaWeb,
  type OllamaWebSearchInput,
} from "./web-search";

export class OllamaWebSearchTool implements vscode.LanguageModelTool<OllamaWebSearchInput> {
  constructor(private readonly auth: OllamaCloudAuth) {}

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
    const apiKey = await this.auth.getApiKey();
    if (!apiKey) {
      throw new Error("Configure an Ollama Cloud API key before using Ollama web search");
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
