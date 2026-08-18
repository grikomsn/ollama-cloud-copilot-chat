import type { OllamaTool } from "../provider/messages";
import { OLLAMA_WEB_SEARCH_TOOL_NAME } from "./registered/web-search-client";

export function bindCredentialToTools(tools: readonly OllamaTool[], credentialRef: string): OllamaTool[] {
  return tools.map((tool) => {
    if (tool.function.name !== OLLAMA_WEB_SEARCH_TOOL_NAME) return tool;
    const parameters = tool.function.parameters;
    const properties = isRecord(parameters.properties) ? parameters.properties : {};
    const required = Array.isArray(parameters.required)
      ? parameters.required.filter((value): value is string => typeof value === "string")
      : [];
    return {
      ...tool,
      function: {
        ...tool.function,
        parameters: {
          ...parameters,
          properties: {
            ...properties,
            credential_ref: { type: "string", enum: [credentialRef] },
          },
          required: [...new Set([...required, "credential_ref"])],
        },
      },
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
