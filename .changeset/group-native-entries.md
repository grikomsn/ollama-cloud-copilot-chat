---
"ollama-cloud-copilot-chat": major
---

Replace stable entry IDs with group-name native entries

Provider entries now use only a VS Code-owned API key; the entry's group name is its label. Credentials, catalogs, usage, and web-search capabilities are scoped by a one-way fingerprint of the key, and model IDs are the raw hosted IDs because the host namespaces them per group.

- Add an Ollama Cloud entry with just an API key (no Stable entry ID field).
- Remove the Select/Forget/Restore entry commands and the `managementEntry` and `inlineSuggestionsEntry` settings; management, inline suggestions, and the web-search tool use the active (most recently provisioned) key.
- Recreate existing entries with the new single-field flow after upgrading; old entry IDs are not migrated.
