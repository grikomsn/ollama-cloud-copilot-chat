# Setup and usage

## Requirements

- Visual Studio Code 1.125 or newer
- GitHub Copilot Chat installed and signed in
- An Ollama account with Cloud API access
- An API key from [Ollama API keys](https://ollama.com/settings/keys)

The Ollama application and CLI are not required. A paid Copilot plan is not required for a bring-your-own-key language model provider.

## Install and connect

1. Install the extension from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=grikomsn.ollama-cloud-copilot-chat).
2. Run **Ollama Cloud: Configure API Key** from the Command Palette.
3. Paste an Ollama API key. The extension validates it before saving it.
4. In Copilot Chat, open the model picker, select **Manage Models**, and enable **Ollama Cloud**.
5. Select an available hosted model.

## Web search tool

The extension contributes **Ollama Cloud Web Search** as a VS Code language-model
tool. In agent mode, enable or reference `ollamaWebSearch` when you want current
web context. The tool uses the Ollama API key already stored in VS Code Secret
Storage and returns titles, URLs, and snippets from Ollama Cloud's web search
endpoint. Ollama limits each request to 10 results; the default is 5.

The key is validated against the hosted catalog and stored in VS Code Secret Storage. The project `.env` file is only a development convenience and is never read by the extension.

## Commands

| Command | Purpose |
| --- | --- |
| **Ollama Cloud: Manage Connection** | Test, refresh, inspect usage or logs, replace or remove the key, or open diagnostics |
| **Ollama Cloud: Configure API Key** | Validate and securely save an Ollama API key |
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

Prompts, responses, tool data, and API keys are never intentionally written to the output channel.

## Subscription usage

The status bar shows exact account utilization as `5h` session and `7d` weekly percentages. Click it for per-model request counts, account activity cost when Ollama provides it, and input/output tokens observed by this extension. Request tokens use native Ollama counts when available and clearly label fallback estimates when a completed stream omits a count.

Account utilization comes from Ollama's bearer-authenticated `/api/usage` response. It does not require browser cookies or page scraping. Ollama describes these limits as GPU/time based rather than fixed token quotas, so the extension keeps account utilization separate from request token totals. The last successful snapshot remains visible if a refresh temporarily fails.

## Thinking effort

Thinking controls appear only where the accepted native values are known. Ordered effort controls default to High, while verified binary controls default On. GPT-OSS offers Low, Medium, and High; Kimi K3 offers Off, Low, High, and Max; GLM 5.2 and DeepSeek V4 offer Off, High, and Max. MiniMax M3 offers Default, Low, Medium, High, and Max; High is selected initially, while an explicit Default leaves the native `think` field unset. Off remains omitted because the service still returns a trace. MiniMax M2.7 remains model-managed because Ollama Cloud does not honor its disable value. The picker selection applies to that request through Ollama's native `think` field.

## Troubleshooting

- **No Ollama Cloud models in the picker:** enable **Ollama Cloud** under **Manage Models**, then run **Ollama Cloud: Refresh Models**.
- **The API key is rejected:** create a fresh key and run **Ollama Cloud: Configure API Key** again.
- **A request times out:** increase `ollamaCloudCopilot.streamIdleTimeoutSeconds` for long pauses between chunks, or `ollamaCloudCopilot.requestTimeoutSeconds` for a longer total generation.
- **An image is rejected:** refresh models and confirm the selected model's tooltip says `text + images`.
- **Usage cannot refresh:** click the status item to retry. The last successful snapshot remains visible with a warning.
- **Need a diagnostic snapshot:** run **Ollama Cloud: Show Diagnostics** and include the generated report when filing an issue.

Never paste API keys, private prompts, responses, images, or tool data into an issue.
