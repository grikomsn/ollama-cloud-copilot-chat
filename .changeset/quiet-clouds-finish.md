---
"ollama-cloud-copilot-chat": patch
---

Fix incomplete thinking streams, expose output-limit failures, close VS Code thinking sections correctly on every exit, enforce required tool calls, preserve native Ollama parallel tool-call history, and avoid treating image base64 as text tokens. The picker now uses exact live-verified controls, adding On/Off for GLM, Kimi K2.6/K2.7 Code, Gemma 4, and Nemotron while keeping MiniMax model-managed because Ollama Cloud ignores its disable value. Refresh the fallback catalog with DeepSeek V4 Flash Preview and stop inferring tool support for unknown models.
