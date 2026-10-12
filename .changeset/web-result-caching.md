---
"ollama-cloud-copilot-chat": minor
---

Cache Ollama Cloud web tool results for the session: repeated searches and page reads within 24 hours cost 0 API calls (failed fetches are retried after 15 minutes; auth, rate-limit, server, and transport failures are never cached), search results gain [truncated]/[complete] markers with an expand input that reads a result in full from the cached search, and both tools report live vs cached provenance.
