import type { OllamaTool } from "../provider/messages";

/** GPT-OSS can leak a Harmony channel marker into a declared function name. */
export function declaredToolName(name: string, tools: readonly OllamaTool[], harmony: boolean): string {
  const names = new Set(tools.map((tool) => tool.function.name));
  if (names.has(name)) return name;
  const decoded = harmony ? /^(.+)<\|channel\|>(?:analysis|commentary|final)$/.exec(name)?.[1] : undefined;
  if (decoded && names.has(decoded)) return decoded;
  throw new Error("Ollama Cloud returned a tool name that was not advertised for this request");
}
