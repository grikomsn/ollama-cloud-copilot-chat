---
"ollama-cloud-copilot-chat": minor
---

Derive thinking pickers for newly hosted models from models.dev reasoning options instead of requiring a hand-verified profile. Toggle-only models get an on/off picker, effort grades map onto low/medium/high/max (xhigh and ultra fold into max), and models verified to leak a reasoning trace when thinking is disabled (gpt-oss family, minimax-m2.7) stay model-managed.
