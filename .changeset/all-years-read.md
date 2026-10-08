---
"ollama-cloud-copilot-chat": major
---

Use native model-provider entries as the only API-key source. Require a stable entryId, preserve model selections across key rotation, isolate credential generations, and add explicit entry selection for management and inline suggestions. Keep minimal observation history and support forgetting in-memory entry bindings.

Add entryId to existing entries and reselect models after upgrading. Command-managed keys and older usage fallback are removed. Keep the existing NDJSON streaming and request-bound web-search capabilities.

Accept the current usage endpoint's request-activity payload and explicitly display unavailable quota limits instead of failing a valid usage refresh.

Normalize GPT-OSS Harmony channel suffixes only against the tool names advertised for the originating request.
