# Setup and usage

## Requirements

- Visual Studio Code 1.125 or newer
- GitHub Copilot Chat installed and signed in
- An Ollama account with Cloud API access
- An API key from [Ollama API keys](https://ollama.com/settings/keys)

The Ollama application and CLI are not required. A paid Copilot plan is not required for a bring-your-own-key language model provider.

## Install and connect

1. Install the extension from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=grikomsn.ollama-cloud-copilot-chat).
2. Open **Manage Language Models**, choose **Add Models**, and select **Ollama Cloud**.
3. Name the provider entry and paste an Ollama API key. VS Code stores the key as a secret.
4. Repeat those steps to add another account or API key. Each entry keeps its catalog, subscription usage, and local token calibration separate.
5. Enable the models you want and select one in Copilot Chat.

## Web search tool

The extension contributes **Ollama Cloud Web Search** as a VS Code language-model
tool. In agent mode, enable or reference `ollamaWebSearch` when you want current
web context. The tool uses the API key from the most recently invoked Ollama
Cloud model entry and returns titles, URLs, and snippets from Ollama Cloud's web search
endpoint. Ollama limits each request to 10 results; the default is 5.

VS Code stores native provider-entry API keys in its secret storage. The legacy **Configure API Key** command remains available for development smoke tests and migration, but native provider entries are the supported multi-account path. The project `.env` file is only a development convenience and is never read by the extension.

## Commands

| Command | Purpose |
| --- | --- |
| **Ollama Cloud: Manage Connection** | Test, refresh, inspect usage or logs, replace or remove the key, or open diagnostics |
| **Ollama Cloud: Configure API Key** | Validate and save a legacy default API key for smoke tests or migration |
| **Ollama Cloud: Remove API Key** | Delete the key and cached usage from VS Code |
| **Ollama Cloud: Refresh Models** | Fetch the current hosted catalog and model metadata |
| **Ollama Cloud: Test Inference** | Send a small live generation request |
| **Ollama Cloud: Show Subscription Usage** | Refresh and inspect account utilization and local request tokens |
| **Ollama Cloud: Open Account Usage** | Open Ollama account usage in the browser |
| **Ollama Cloud: Open API Keys** | Open Ollama API-key management |
| **Ollama Cloud: Show Diagnostics** | Show provider state and registered models without secrets |

## Settings

| Setting | Default | Purpose |
| --- | ---: | --- |
| `ollamaCloudCopilot.maxOutputTokens` | `65536` | Requested generation ceiling, capped by the selected model and remaining context |
| `ollamaCloudCopilot.requestTimeoutSeconds` | `600` | Maximum total request duration in seconds |
| `ollamaCloudCopilot.streamIdleTimeoutSeconds` | `120` | Maximum seconds without streamed response data |
| `ollamaCloudCopilot.catalogCacheMinutes` | `30` | Model metadata refresh interval |
| `ollamaCloudCopilot.showUsageStatusBar` | `true` | Show five-hour and weekly subscription usage |
| `ollamaCloudCopilot.debugLogging` | `false` | Log secret-safe request, discovery, and usage metadata |
| `ollamaCloudCopilot.inlineSuggestions` | `false` | Experimental ghost-text inline completions while typing |
| `ollamaCloudCopilot.inlineSuggestionsModel` | `gemma4:31b` | Model used for inline completions; pick one that completes cleanly with `think` disabled |
| `ollamaCloudCopilot.inlineSuggestionsChatInput` | `false` | Also offer suggestions inside the Copilot Chat prompt box |
| `ollamaCloudCopilot.inlineSuggestionsDebounceMs` | `300` | Debounce between typing and a completion request |
| `ollamaCloudCopilot.inlineSuggestionsTimeoutMs` | `3000` | Per-request completion timeout |
| `ollamaCloudCopilot.inlineSuggestionsMaxTokens` | `128` | Tokens generated per suggestion |
| `ollamaCloudCopilot.inlineSuggestionsPrefixLines` | `10` | Document lines sent before the cursor |
| `ollamaCloudCopilot.inlineSuggestionsSuffixChars` | `300` | Document characters sent after the cursor |

Prompts, responses, tool data, and API keys are never intentionally written to the output channel.

## Inline suggestions

Inline code suggestions are experimental and off by default. When enabled, each suggestion sends a bounded fill-in-the-middle window (10 lines before the cursor, 300 characters after, both configurable) to the native `https://ollama.com/api/chat` endpoint with `think: false`, so thinking models cannot emit hidden reasoning into ghost text. Live-measured defaults: `gemma4:31b` (751ms total, zero reasoning) and `glm-5.1`. Narration-prone models — Kimi K2.6 and DeepSeek V4 Flash describe the code instead of completing it — are not recommended. A single surrounding code fence is stripped from suggestions. No suggestion appears in the Copilot Chat prompt box unless `ollamaCloudCopilot.inlineSuggestionsChatInput` is enabled.

## Subscription usage

The status bar shows exact account utilization as `5h` session and `7d` weekly percentages. Click it for per-model request counts, account activity cost when Ollama provides it, and input/output tokens observed by this extension. Request tokens use native Ollama counts when available and clearly label fallback estimates when a completed stream omits a count.

Account utilization comes from Ollama's bearer-authenticated `/api/usage` response. It does not require browser cookies or page scraping. Ollama describes these limits as GPU/time based rather than fixed token quotas, so the extension keeps account utilization separate from request token totals. The last successful snapshot remains visible if a refresh temporarily fails.

## Thinking effort

Thinking controls appear only where the accepted native values are known. Ordered effort controls default to High, while verified binary controls default On. GPT-OSS offers Low, Medium, and High; Kimi K3 offers Off, Low, High, and Max; GLM 5.2 and DeepSeek V4 offer Off, High, and Max. MiniMax M3 offers Default, Low, Medium, High, and Max; High is selected initially, while an explicit Default leaves the native `think` field unset. Off remains omitted because the service still returns a trace. MiniMax M2.7 remains model-managed because Ollama Cloud does not honor its disable value. The picker selection applies to that request through Ollama's native `think` field.

## Troubleshooting

- **No Ollama Cloud models in the picker:** open **Manage Language Models**, add an Ollama Cloud entry, and enable its models.
- **The API key is rejected:** create a fresh key and update the API key on that provider entry.
- **A request times out:** increase `ollamaCloudCopilot.streamIdleTimeoutSeconds` for long pauses between chunks, or `ollamaCloudCopilot.requestTimeoutSeconds` for a longer total generation.
- **An image is rejected:** refresh models and confirm the selected model's tooltip says `text + images`.
- **Usage cannot refresh:** click the status item to retry. The last successful snapshot remains visible with a warning.
- **Need a diagnostic snapshot:** run **Ollama Cloud: Show Diagnostics** and include the generated report when filing an issue.

Never paste API keys, private prompts, responses, images, or tool data into an issue.
