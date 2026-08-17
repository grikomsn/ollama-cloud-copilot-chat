# Repository guide

## Project

This is a strict-TypeScript VS Code `LanguageModelChatProvider` that connects
GitHub Copilot Chat directly to Ollama Cloud. It never requires or invokes a
local Ollama installation.

- `src/extension.ts`: activation, commands, connection UI, and diagnostics
- `src/provider.ts`: VS Code provider integration and native Ollama chat requests
- `src/catalog.ts`: cloud model discovery, `/api/show` hydration, and fallback metadata
- `src/convert.ts`: VS Code message/tool conversion
- `src/model-options.ts`: model-picker thinking controls
- `src/models/metadata.ts`: persisted models.dev enrichment for fields omitted by Ollama discovery
- `src/ndjson.ts`: fragmented native Ollama response stream parsing
- `src/auth.ts`: API keys in VS Code Secret Storage
- Tests are colocated as `src/*.test.ts`.

## Development

- Use Node.js 22 or newer and npm.
- Use two-space indentation, double quotes, semicolons, and explicit types at API boundaries.
- Keep credentials in Secret Storage. Never log keys, prompts, responses, or tool results.
- Preserve streaming, cancellation, multimodal input, tool calls, thinking parts, and usage reporting.
- Add pure `node:test` coverage for parsing and external-data behavior.
- Do not commit `node_modules/`, `out/`, `.env*`, `*.vsix`, or generated source maps.

Run:

```bash
npm ci
npm test
npm run package
```

Add a Changeset for user-visible behavior. Do not manually bump versions outside
the release workflow.
