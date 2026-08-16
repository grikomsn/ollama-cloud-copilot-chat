// This is an extension-registered VS Code tool. It calls Ollama's web-search
// endpoint when VS Code invokes it; it is not an Ollama chat hosted tool.
export { OllamaWebSearchTool } from "./web-search-tool";
export { OLLAMA_WEB_SEARCH_TOOL_NAME, createWebSearchRequestCancellation, formatOllamaWebSearch, searchOllamaWeb } from "./web-search-client";
export type { OllamaWebSearchInput, OllamaWebSearchResponse, OllamaWebSearchResult, WebSearchCancellationToken } from "./web-search-client";
