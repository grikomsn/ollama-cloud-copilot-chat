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
3. Name the provider entry, set a unique lowercase **Stable entry ID** (`entryId`, for example `work`), and paste an Ollama API key. VS Code stores the key as a secret.
4. Repeat those steps to add another account or API key. Model selections use the stable entry ID. Catalog, subscription usage, and token calibration use credential fingerprints; entries sharing a key share that account scope.
5. Enable the models you want and select one in Copilot Chat.

## Web search tool

The extension contributes **Ollama Cloud Web Search** as a VS Code language-model
tool. In agent mode, enable or reference `ollamaWebSearch` when you want current
web context. The tool uses an opaque, expiring capability bound to the Ollama
Cloud request that issued the tool call and returns titles, URLs, and snippets from Ollama Cloud's web search
endpoint. Ollama limits each request to 10 results; the default is 5.

VS Code owns all native provider-entry keys. The extension retains provisioned keys only in memory and does not read command-managed keys or `.env`. Add `entryId` to existing entries and reselect your models after upgrading. Keep that ID when rotating a key; stale model handles fail rather than switching credentials. Use distinct IDs even when display names match.

Select the entry for management with **Ollama Cloud: Select Entry for Usage and Management**, and select the inline account separately with **Ollama Cloud: Select Inline Suggestions Entry**. Both choices persist as IDs, with no fallback to the first discovered key. After a restart, open **Manage Language Models** to provision entries before using these features. Removed native entries can remain in discovery history and memory until reload because VS Code provides no entry-removal callback. **Manage Connection → Forget an observed entry** clears the extension's history and in-memory binding; remove the native entry in VS Code as well.

## Commands

| Command | Purpose |
| --- | --- |
| **Ollama Cloud: Manage Connection** | Select entries, test, refresh, inspect usage or logs, or open native entry management |
| **Ollama Cloud: Select Entry for Usage and Management** | Choose the provisioned entry used by management commands |
| **Ollama Cloud: Select Inline Suggestions Entry** | Explicitly bind inline suggestions to a provisioned entry |
| **Ollama Cloud: Refresh Models** | Fetch the current hosted catalog and model metadata |
| **Ollama Cloud: Test Inference** | Send a small live generation request |
| **Ollama Cloud: Show Subscription Usage** | Refresh and inspect account utilization and local request tokens |
| **Ollama Cloud: Open Account Usage** | Open Ollama account usage in the browser |
| **Ollama Cloud: Open API Keys** | Open Ollama API-key management |
| **Ollama Cloud: Show Diagnostics** | Show provider state and registered models without secrets |

## Settings

| Setting | Default | Purpose |
| --- | ---: | --- |
| `ollamaCloudCopilot.managementEntry` | empty | Entry ID for management commands |
| `ollamaCloudCopilot.inlineSuggestionsEntry` | empty | Entry ID for inline suggestions |
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

Inline code suggestions are experimental and off by default. When enabled, each suggestion sends a bounded fill-in-the-middle window (10 lines before the cursor, 300 characters after, both configurable) to the native `https://ollama.com/api/chat` endpoint with `think: false`, so thinking models cannot emit hidden reasoning into ghost text. Live-measured defaults: `gemma4:31b` (751ms total, zero reasoning) and `glm-5.2`. Narration-prone models — GLM 5.3, GLM 5.3 Flash, Kimi K2.6, and the DeepSeek V4 variants describe the code instead of completing it — are not recommended. GLM 5.3 Flash completes cleanly on some other hosts, but with `think: false` Ollama Cloud streams its reasoning into the visible content, so it stays out of the vetted list. A single surrounding code fence is stripped from suggestions. No suggestion appears in the Copilot Chat prompt box unless `ollamaCloudCopilot.inlineSuggestionsChatInput` is enabled.

**Ollama Cloud: Set Inline Suggestions Model** (also in the Manage menu) lists compatible models ordered cheap-and-fast first, each with a measured badge (for example "★ recommended · measured 0.6s TTFB") or a warning for models measured to narrate instead of completing. A "Use a custom model id…" entry keeps any hosted model reachable. The command only writes settings, so changes apply on the next keystroke without a reload.

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

The usage endpoint can return request statistics without subscription limits. In that case the UI shows account request activity and explicitly marks quota limits unavailable, while retaining credential-scoped local inference counts. It does not calculate quota percentages from request counts.
