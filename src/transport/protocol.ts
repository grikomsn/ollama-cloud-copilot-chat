export const OLLAMA_CLOUD_ORIGIN = "https://ollama.com";
export const OLLAMA_CLOUD_API = `${OLLAMA_CLOUD_ORIGIN}/api`;

export const OLLAMA_ENDPOINTS = {
  chat: `${OLLAMA_CLOUD_API}/chat`,
  models: `${OLLAMA_CLOUD_API}/tags`,
  model: `${OLLAMA_CLOUD_API}/show`,
  usage: `${OLLAMA_CLOUD_API}/usage`,
  webSearch: `${OLLAMA_CLOUD_API}/web_search`,
} as const;

export type OllamaAccept = "application/json" | "application/x-ndjson";

export function ollamaHeaders(apiKey: string, accept: OllamaAccept = "application/json", userAgent?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: accept,
    ...(userAgent ? { "User-Agent": userAgent } : {}),
  };
}
