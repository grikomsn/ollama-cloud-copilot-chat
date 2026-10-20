import type { OllamaTool } from "../provider/messages";

/** Repair formatting only when the result exactly matches an advertised name. */
export function declaredToolName(name: string, tools: readonly OllamaTool[], harmony: boolean): string {
  const names = new Set(tools.map((tool) => tool.function.name));
  if (names.has(name)) return name;
  const trimmed = name.trim();
  const decoded = harmony ? /^(.+)<\|channel\|>(?:analysis|commentary|final)$/.exec(trimmed)?.[1] : undefined;
  for (const candidate of [trimmed, ...(decoded ? [decoded] : [])]) {
    if (names.has(candidate)) return candidate;
    const unqualified = candidate.startsWith("functions.") ? candidate.slice("functions.".length) : undefined;
    if (unqualified && names.has(unqualified)) return unqualified;
  }
  const namespace = trimmed.startsWith("functions.") ? "functions" : trimmed.includes(".") ? "other" : "none";
  throw new Error(
    `Ollama Cloud returned a tool name that was not advertised for this request (nameLength=${name.length}, advertisedTools=${tools.length}, namespace=${namespace}). The model must use a tool from the current request; retry or select another model.`,
  );
}
