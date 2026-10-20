---
"ollama-cloud-copilot-chat": patch
---

Keep tool-result images in native image fields instead of serializing base64 into prompt text, reject oversized requests before sending, and explain how to recover from context-window errors.
