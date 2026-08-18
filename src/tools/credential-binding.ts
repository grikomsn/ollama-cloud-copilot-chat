import type { OllamaMessage, OllamaTool } from "../provider/messages";
import { OLLAMA_WEB_SEARCH_TOOL_NAME } from "./registered/web-search-client";

export interface BoundCredentialTools {
  readonly tools: readonly OllamaTool[];
  bindMessages(messages: readonly OllamaMessage[]): readonly OllamaMessage[];
  routeToolCall(name: string, input: Record<string, unknown>): { name: string; input: Record<string, unknown> };
}

export function bindCredentialToTools(tools: readonly OllamaTool[], capability: string): BoundCredentialTools {
  const alias = `${OLLAMA_WEB_SEARCH_TOOL_NAME}__${capability.replaceAll("-", "_")}`;
  return {
    tools: tools.map((tool) => tool.function.name === OLLAMA_WEB_SEARCH_TOOL_NAME
      ? { ...tool, function: { ...tool.function, name: alias } }
      : tool),
    bindMessages: (messages) => messages.map((message) => ({
      ...message,
      ...(message.tool_calls ? {
        tool_calls: message.tool_calls.map((call) => call.function.name === OLLAMA_WEB_SEARCH_TOOL_NAME
          ? { ...call, function: { ...call.function, name: alias } }
          : call),
      } : {}),
      ...(message.tool_name === OLLAMA_WEB_SEARCH_TOOL_NAME ? { tool_name: alias } : {}),
    })),
    routeToolCall: (name, input) => {
      if (name === alias) {
        return {
          name: OLLAMA_WEB_SEARCH_TOOL_NAME,
          input: { ...input, credential_capability: capability },
        };
      }
      if (name === OLLAMA_WEB_SEARCH_TOOL_NAME || name.startsWith(`${OLLAMA_WEB_SEARCH_TOOL_NAME}__`)) {
        throw new Error("Ollama Cloud returned an unbound web-search tool call");
      }
      return { name, input };
    },
  };
}
