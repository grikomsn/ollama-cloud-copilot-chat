# Models and accounting

## Live metadata

The extension discovers the catalog available to the configured account and enriches each entry with authenticated `/api/show` metadata. Live responses provide the context window, architecture, parameter size, quantization, and capabilities used by Copilot Chat. A bundled snapshot keeps model selection useful during transient metadata failures.

The fallback snapshot was last updated on 2026-08-01:

| Model | Context | Images | Tools | Thinking |
| --- | ---: | :---: | :---: | :---: |
| DeepSeek V4 Flash 0731 | 1.049M | No | Yes | Effort |
| Kimi K3 | 1.049M | Yes | Yes | Effort |
| Kimi K2.7 Code | 262K | Yes | Yes | Effort |
| GLM 5.2 | 1M | No | Yes | Effort |
| MiniMax M3 | 524K | Yes | Yes | Effort |
| Nemotron 3 Ultra | 262K | No | Yes | Effort |
| DeepSeek V4 Pro | 524K | No | Yes | Effort |
| DeepSeek V4 Flash | 1.049M | No | Yes | Effort |
| Gemma 4 31B | 262K | Yes | Yes | Effort |
| Qwen 3.5 397B | 262K | Yes | Yes | Effort |
| Kimi K2.6 | 262K | Yes | Yes | Effort |
| MiniMax M2.7 | 197K | No | Yes | Effort |
| GLM 5.1 | 203K | No | Yes | Effort |
| Nemotron 3 Super | 262K | No | Yes | Effort |
| Nemotron 3 Nano 30B | 262K | No | Yes | Effort |
| Mistral Large 3 675B | 262K | Yes | Yes | No |
| GPT-OSS 120B | 131K | No | Yes | Low / Medium / High |
| GPT-OSS 20B | 131K | No | Yes | Low / Medium / High |

Live catalog and `/api/show` results remain authoritative when they differ from this snapshot. Kimi K2.5 and MiniMax M2.5 were removed from the fallback after their 2026-07-31 retirement. See [Cloud model retirements](https://docs.ollama.com/cloud#retirements).

Kimi K3 currently requires an Ollama Pro or Max subscription and consumes extra usage credits. See [Kimi K3 on Ollama](https://ollama.com/library/kimi-k3).

## Thinking

Ollama's thinking API accepts boolean controls or named effort levels. GPT-OSS supports `low`, `medium`, and `high`. Other compatible models can support `low`, `medium`, `high`, and `max`, with an Off choice when the hosted backend honors `think: false`. See [Ollama thinking](https://docs.ollama.com/capabilities/thinking).

Live Cloud probes show MiniMax models continuing to return reasoning when `think: false`, so their picker intentionally omits the misleading Off choice.

## Pricing and token accounting

Ollama Cloud access is sold through account plans rather than published per-model token prices. The extension labels model usage as included with the subscription instead of inventing an input/output price. See [Ollama pricing](https://ollama.com/pricing).

Every completed inference reports the exact `prompt_eval_count` and `eval_count` returned by Ollama. Those values update Copilot Chat's context indicator and the extension's locally tracked totals. They are separate from the five-hour and weekly account-utilization percentages, which measure subscription capacity.
