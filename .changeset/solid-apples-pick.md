---
"ollama-cloud-copilot-chat": patch
---

Fix Auto context size being interpreted as zero input tokens by VS Code, collapsing the context indicator to the output reserve and triggering premature compaction.

Prefer the declared architecture context field and honor live context limits rather than flooring them at a bundled snapshot.
