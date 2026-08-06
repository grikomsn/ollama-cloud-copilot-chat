# Models and accounting

## Live metadata

The extension discovers the catalog available to the configured account and enriches each entry with authenticated `/api/show` metadata. Live responses provide the context window, architecture, parameter size, quantization, and capabilities used by Copilot Chat. A bundled snapshot keeps model selection useful during transient metadata failures.

The fallback snapshot was last updated on 2026-08-07:

| Model | Context | Images | Tools | Thinking |
| --- | ---: | :---: | :---: | :---: |
| DeepSeek V4 Flash 0731 | 1.049M | No | Yes | On / Off |
| Kimi K3 | 1.049M | Yes | Yes | Model-managed |
| Kimi K2.7 Code | 262K | Yes | Yes | On / Off |
| GLM 5.2 | 1M | No | Yes | On / Off |
| MiniMax M3 | 524K | Yes | Yes | Model-managed |
| Nemotron 3 Ultra | 262K | No | Yes | On / Off |
| DeepSeek V4 Pro | 524K | No | Yes | On / Off |
| DeepSeek V4 Flash Preview | 1.049M | No | Yes | On / Off |
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

The picker exposes controls only for exact model IDs verified against Ollama Cloud. GPT-OSS supports `low`, `medium`, and `high` and cannot disable thinking. DeepSeek V4, Qwen 3.5, GLM 5.1/5.2, Kimi K2.6/K2.7 Code, Gemma 4, and Nemotron 3 expose On/Off because live native `/api/chat` requests verified that `think: false` suppresses the trace and `think: true` restores it.

MiniMax M3 and M2.7 remain model-managed because Ollama Cloud accepts `think: false` but continues returning a thinking trace. Kimi K3 remains model-managed until its Ollama-specific effort values can be verified with the extra usage its Cloud endpoint requires. A broad `/api/show` `thinking` capability does not grant controls to an unknown or newly discovered model. See [Ollama thinking](https://docs.ollama.com/capabilities/thinking), [MiniMax M3](https://ollama.com/library/minimax-m3), and [Kimi K3](https://ollama.com/library/kimi-k3).

Thinking, visible output, and tool calls all consume the generated-token allowance. The provider reserves output space inside the model's single context budget, reports `done_reason: length` as an actionable error, and never treats an Ollama stream that ends without `done: true` as a successful response.

## Pricing and token accounting

Ollama Cloud access is sold through account plans rather than published per-model token prices. The extension labels model usage as included with the subscription instead of inventing an input/output price. See [Ollama pricing](https://ollama.com/pricing).

Every completed inference reports the exact `prompt_eval_count` and `eval_count` returned by Ollama. Those values update Copilot Chat's context indicator and the extension's locally tracked totals. They are separate from the five-hour and weekly account-utilization percentages, which measure subscription capacity.
