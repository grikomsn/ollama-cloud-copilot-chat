export function messageOf(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "Request cancelled or timed out";
    return error.message;
  }
  return String(error);
}

export async function apiError(prefix: string, response: Response): Promise<Error> {
  const text = (await response.text().catch(() => "")).trim();
  let detail = text;
  try {
    const json = JSON.parse(text) as {
      error?: { message?: string } | string;
      detail?: string;
      message?: string;
    };
    detail = typeof json.error === "string"
      ? json.error
      : json.error?.message ?? json.detail ?? json.message ?? text;
  } catch {
    // Keep the response text.
  }
  return new Error(`${prefix} (HTTP ${response.status})${detail ? `: ${detail.slice(0, 1000)}` : ""}`);
}
