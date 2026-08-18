# Security design

## Credentials

API keys added through **Manage Language Models** are marked as secret provider
configuration, so VS Code stores each entry's value in its secret storage. The
extension receives the resolved key only while discovering or invoking that
entry and keeps only a short SHA-256-derived reference in model metadata,
catalog-cache keys, and usage state.

The legacy configuration command stores one migration or smoke-test key under
`ollamaCloudCopilot.apiKey` in VS Code Secret Storage. It removes that value
only after explicit user confirmation.

The runtime does not read `.env`, workspace settings, or process environment
variables for credentials.

## Network boundary

Requests go directly to `https://ollama.com/api/tags`, `/api/show`, `/api/chat`,
and `/api/usage`. There is no extension-operated proxy or bundled local server.
Usage retrieval uses the same bearer API key; it does not access browser
cookies or scrape the account page.

## Logging

Default logs contain activation, model count, and secret-safe failure details.
Optional debug logs add model IDs, thinking selection, tool count, output
ceiling, initiator, and token counts. The extension never intentionally logs:

- API keys or authorization headers
- prompts or responses
- images
- tool schemas, arguments, or results

## Untrusted data

Catalog and stream payloads are parsed defensively. Malformed catalog metadata
falls back to a bundled snapshot. Malformed stream lines fail the request rather
than turning a truncated response into apparent success. Tool calls are emitted to Copilot as structured requests;
the extension does not execute tools itself. Malformed usage responses preserve
the last successful account snapshot and record a secret-safe refresh error.
