# Models and accounting

## Live metadata

The extension discovers the catalog available to the configured account and enriches each entry with authenticated `/api/show` metadata. Live responses provide the context window, architecture, parameter size, quantization, and capabilities used by Copilot Chat. A bundled snapshot keeps model selection useful during transient metadata failures.

The fallback snapshot was last updated on 2026-08-16:

| Model | Context | Images | Tools | Thinking |
| --- | ---: | :---: | :---: | :---: |
| DeepSeek V4 Flash 0731 | 1.049M | No | Yes | Off / High / Max |
| Kimi K3 | 1.049M | Yes | Yes | Off / Low / High / Max |
| Kimi K2.7 Code | 262K | Yes | Yes | On / Off |
| GLM 5.2 | 1M | No | Yes | Off / High / Max |
| MiniMax M3 | 524K | Yes | Yes | Default / Low / Medium / High / Max |
| Nemotron 3 Ultra | 262K | No | Yes | On / Off |
| DeepSeek V4 Pro Preview | 524K | No | Yes | Off / High / Max |
| DeepSeek V4 Pro 0813 | 1.049M | No | Yes | Off / High / Max |
| DeepSeek V4 Flash Preview | 1.049M | No | Yes | Off / High / Max |
| Gemma 4 31B | 262K | Yes | Yes | On / Off |
| Qwen 3.5 397B | 262K | Yes | Yes | On / Off |
| Kimi K2.6 | 262K | Yes | Yes | On / Off |
| MiniMax M2.7 | 197K | No | Yes | Model-managed |
| GLM 5.1 | 203K | No | Yes | On / Off |
| Nemotron 3 Super | 262K | No | Yes | On / Off |
| Nemotron 3 Nano 30B | 262K | No | Yes | On / Off |
| Mistral Large 3 675B | 262K | Yes | Yes | No |
| GPT-OSS 120B | 131K | No | Yes | Low / Medium / High |
| GPT-OSS 20B | 131K | No | Yes | Low / Medium / High |

Live catalog and `/api/show` results remain authoritative when they differ from this snapshot. Kimi K2.5 and MiniMax M2.5 were removed from the fallback after their 2026-07-31 retirement. See [Cloud model retirements](https://docs.ollama.com/cloud#retirements).

Kimi K3 currently requires an Ollama Pro or Max subscription and consumes extra usage credits. See [Kimi K3 on Ollama](https://ollama.com/library/kimi-k3).

## Thinking

The picker exposes controls only for exact model IDs verified against Ollama Cloud. GPT-OSS supports `low`, `medium`, and `high` and cannot disable thinking. Kimi K3 supports Off plus `low`, `high`, and `max`; its `medium` value behaves as a low-effort alias and is intentionally omitted. GLM 5.2 supports Off, High, and Max; its `low` and `medium` values alias High. DeepSeek V4 supports Off, High, and Max.

Qwen 3.5, GLM 5.1, Kimi K2.6/K2.7 Code, Gemma 4, and Nemotron 3 expose On/Off. Live requests verified that `think: false` suppresses their trace, while their string effort values did not establish distinct ordered levels. MiniMax M3 exposes Default, Low, Medium, High, and Max: Default omits `think`, preserving the model's adaptive behavior, while the four effort values are forwarded unchanged. Its `think: false` request still returns a trace, so Off is intentionally unavailable. MiniMax M2.7 remains model-managed for the same reason. Mistral Large 3 exposes no thinking control because none of the native values produced a trace. A broad `/api/show` `thinking` capability does not grant controls to an unknown or newly discovered model. See [Ollama thinking](https://docs.ollama.com/capabilities/thinking), [DeepSeek V4 Pro](https://ollama.com/library/deepseek-v4-pro), [MiniMax M3](https://ollama.com/library/minimax-m3), and [Kimi K3](https://ollama.com/library/kimi-k3).

Thinking, visible output, and tool calls all consume the generated-token allowance. The provider reserves output space inside the model's single context budget, reports `done_reason: length` as an actionable error, and never treats an Ollama stream that ends without `done: true` as a successful response.

## Pricing and token accounting

Ollama Cloud access is sold through account plans rather than published per-model token prices. The extension labels model usage as included with the subscription instead of inventing an input/output price. See [Ollama pricing](https://ollama.com/pricing).

Every successfully completed inference reports usage to Copilot Chat. The extension uses Ollama's exact `prompt_eval_count` and `eval_count` when available, preserves counts delivered on separate stream events, and estimates only a missing value from the request and generated output. This prevents VS Code from replacing unknown usage with zero. Locally estimated values are labeled in the usage picker and remain separate from the five-hour and weekly account-utilization percentages, which measure subscription capacity.
