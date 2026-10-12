import { declaredToolName } from "./tool-name";
import type { OllamaMessage, OllamaTool } from "../provider/messages";
import { OLLAMA_WEB_FETCH_TOOL_NAME } from "./registered/web-fetch-client";
import { OLLAMA_WEB_SEARCH_TOOL_NAME } from "./registered/web-search-client";

/** Extension-registered Ollama web tools bound to the selected model's credential. */
const BOUND_TOOL_NAMES = [OLLAMA_WEB_SEARCH_TOOL_NAME, OLLAMA_WEB_FETCH_TOOL_NAME] as const;

export interface BoundCredentialTools {
  readonly tools: readonly OllamaTool[];
  bindMessages(messages: readonly OllamaMessage[]): readonly OllamaMessage[];
  routeToolCall(name: string, input: Record<string, unknown>): { name: string; input: Record<string, unknown> };
}

export function bindCredentialToTools(tools: readonly OllamaTool[], capability: string, harmony = false): BoundCredentialTools {
  const suffix = capability.replaceAll("-", "_");
  const aliasByBase = new Map<string, string>(BOUND_TOOL_NAMES.map((base) => [base, `${base}__${suffix}`]));
  const baseByAlias = new Map([...aliasByBase].map(([base, alias]) => [alias, base]));
  const boundTools = tools.map((tool) => {
    const alias = aliasByBase.get(tool.function.name);
    return alias ? { ...tool, function: { ...tool.function, name: alias } } : tool;
  });
  return {
    tools: boundTools,
    bindMessages: (messages) => messages.map((message) => ({
      ...message,
      ...(message.tool_calls ? {
        tool_calls: message.tool_calls.map((call) => {
          const alias = aliasByBase.get(call.function.name);
          return alias ? { ...call, function: { ...call.function, name: alias } } : call;
        }),
      } : {}),
      ...(message.tool_name !== undefined && aliasByBase.has(message.tool_name)
        ? { tool_name: aliasByBase.get(message.tool_name) }
        : {}),
    })),
    routeToolCall: (name, input) => {
      name = declaredToolName(name, boundTools, harmony);
      const base = baseByAlias.get(name);
      if (base) {
        return {
          name: base,
          input: { ...input, credential_capability: capability },
        };
      }
      // Any other web-tool-shaped name that was somehow advertised is not
      // bound to this credential and must not route.
      for (const candidate of BOUND_TOOL_NAMES) {
        if (name === candidate || name.startsWith(`${candidate}__`)) {
          throw new Error(`Ollama Cloud returned an unbound ${candidate} tool call`);
        }
      }
      return { name, input };
    },
  };
}
