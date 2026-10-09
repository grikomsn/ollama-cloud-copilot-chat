---
"ollama-cloud-copilot-chat": patch
---

Add a thinking picker for Mistral Large 4

Live probes (2026-09-09 against ollama.com) confirmed `mistral-large-4` advertises thinking in `/api/show` and accepts native `think` values `low`/`true`/`false`, while the older `mistral-large-3:675b` has no thinking capability and correctly stays model-managed. `mistral-large-4` now gets the standard Off/On control.

Also re-verified against the native `think` field (not the OpenAI-compat surface): it only accepts `low|medium|high|max|true|false` — the permissive `xhigh/none/minimal/ultra` values seen on `/v1/chat/completions` are rejected natively, so existing gpt-oss and MiniMax M3 profiles remain unchanged.
