---
"ollama-cloud-copilot-chat": patch
---

Repair whitespace and functions-namespace formatting only against advertised tool names, remind models to use the current tool list, and validate complete tool-call batches before forwarding them. Keep credential aliases scoped to the current request and report rejected-name structure without exposing tool names.
