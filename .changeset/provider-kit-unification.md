---
"ollama-cloud-copilot-chat": patch
---

Keep thinking in one bubble and retry transient failures

- Thinking parts now carry a stable request-scoped segment id, so streamed reasoning stays in one bubble instead of splitting per delta.
- Transient 429/502/503/504 and connection failures before streaming are retried with bounded backoff, and request bodies no longer carry lone UTF-16 surrogates.
- The response reader always releases and cancels the stream on failure, and the picker shows cached-input prices.

Shared provider plumbing now comes from the copilot-chat-kit submodule, so fixes land in every Copilot Chat provider extension at once.
