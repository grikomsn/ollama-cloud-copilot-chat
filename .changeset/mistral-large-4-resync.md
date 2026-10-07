---
"ollama-cloud-copilot-chat": patch
---

Add Mistral Large 4 to the bundled cloud model snapshot and picker pricing.

The live `/api/tags` catalog added `mistral-large-4` on 2026-10-06; the
snapshot now carries it with its live-verified 1M context window and
vision/tools/thinking capabilities. Its published rates ($1.36 in / $0.14
cached / $4.18 out per 1M tokens) replace the subscription-credit label in
the model picker. The model ships without a thinking-effort control until
its native values are live-verified, matching the Mistral Large 3
precedent.
