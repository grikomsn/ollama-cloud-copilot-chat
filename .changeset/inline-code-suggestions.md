---
"ollama-cloud-copilot-chat": minor
---

Add experimental, opt-in inline code suggestions (ghost text) powered by Ollama Cloud with the native `think: false` request field. Enable with `ollamaCloudCopilot.inlineSuggestions` and choose the model (`inlineSuggestionsModel`, default `gemma4:31b`; live-measured zero reasoning and 751ms total). Debounce, timeout, token budget, and context windows are configurable. Surrounding code fences are stripped from suggestions, the Copilot Chat prompt box is excluded unless separately enabled, and document context is never logged.
