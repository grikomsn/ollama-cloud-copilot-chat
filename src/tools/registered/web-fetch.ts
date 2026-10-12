// This is an extension-registered VS Code tool. It calls Ollama's web-fetch
// endpoint when VS Code invokes it; it is not an Ollama chat hosted tool.
export { OllamaWebFetchTool } from "./web-fetch-tool";
export {
  OLLAMA_WEB_FETCH_TOOL_NAME,
  fetchOllamaWeb,
  formatOllamaWebFetch,
  parseFetchResponse,
  webFetchFailureMessage,
} from "./web-fetch-client";
export type { OllamaWebFetchInput, OllamaWebFetchResponse } from "./web-fetch-client";
