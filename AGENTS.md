# Repository guide

## Project

This is a strict-TypeScript VS Code `LanguageModelChatProvider` that connects
GitHub Copilot Chat directly to Ollama Cloud. It never requires or invokes a
local Ollama installation.

- `src/extension.ts`: activation, commands, connection UI, and diagnostics
- `src/provider.ts`: VS Code provider integration and native Ollama chat requests
- `src/models/catalog.ts`: cloud model discovery, `/api/show` hydration, and fallback metadata
  - `CATALOG_CACHE_KEY` in `src/models/catalog.ts` keys persisted per-credential caches. Bump its version (and update the comment above it) when ids retire or delist from the hosted catalog so stale caches do not keep serving removed entries; additions alone do not require a bump.
- `src/models/options.ts`: model-picker thinking controls
- `src/models/metadata.ts`: persisted models.dev enrichment for fields omitted by Ollama discovery
- `src/provider/`: native message/tool conversion, `tool_name` history grouping, response state, usage, and token estimates
- `src/transport/`: fixed endpoints and fragmented native NDJSON stream parsing
- `src/tools/`: caller-executed tools, credential binding, and the registered web search/fetch tools
- `src/autocomplete/`: opt-in inline suggestions over the native NDJSON engine
- `src/usage/`: account usage, balance, and status-bar rendering
- `src/kit/`: shared [copilot-chat-kit](https://github.com/grikomsn/copilot-chat-kit) git submodule (Unicode-safe JSON, errors, retry, request deadlines, SSE and Chat Completions parsing, message conversion, history trimming, response writing, usage payloads, pricing, context tiers, credentials, models.dev snapshots, inline-suggestion shell, VS Code API augmentations). Provider quirks stay outside it and configure it through options
- Tests are colocated as `src/**/*.test.ts`.

## Development

- Use Node.js 22 or newer and npm.
- Use two-space indentation, double quotes, semicolons, and explicit types at API boundaries.
- API keys live only in VS Code-managed provider-entry configuration and in memory (the kit's `Credentials`). Never log keys, prompts, responses, or tool results.
- `src/kit/` is the shared copilot-chat-kit git submodule. Clone with `--recurse-submodules` (or run `git submodule update --init`). Never edit kit files only here: commit and push the change to the kit repository (inside `src/kit` or in its own checkout), then commit the submodule bump with `git submodule update --remote src/kit`.
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
