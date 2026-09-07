---
"ollama-cloud-copilot-chat": patch
---

Keep the advertised context window for verified snapshot models at or above the verified value: a live `/api/show` misread (for example a base-model `.context_length` reported before the product key) can no longer collapse the picker window below the snapshot, while larger live values (model upgrades) still win.
