<p align="center">
  <img src="https://raw.githubusercontent.com/grikomsn/ollama-cloud-copilot-chat/main/assets/cover.jpg" alt="Ollama Cloud and GitHub Copilot" width="960">
</p>

<h1 align="center">Ollama Cloud for GitHub Copilot Chat</h1>

<p align="center">Use hosted Ollama Cloud models directly from the GitHub Copilot Chat model picker in Visual Studio Code—without installing Ollama or running a local model server.</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=grikomsn.ollama-cloud-copilot-chat"><img src="https://img.shields.io/visual-studio-marketplace/v/grikomsn.ollama-cloud-copilot-chat?style=flat-square&logo=visualstudiocode&label=Marketplace" alt="Visual Studio Marketplace version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=grikomsn.ollama-cloud-copilot-chat"><img src="https://img.shields.io/visual-studio-marketplace/i/grikomsn.ollama-cloud-copilot-chat?style=flat-square&label=Installs" alt="Visual Studio Marketplace installs"></a>
  <a href="https://github.com/grikomsn/ollama-cloud-copilot-chat/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/grikomsn/ollama-cloud-copilot-chat/ci.yml?branch=main&style=flat-square&label=CI" alt="CI status"></a>
  <a href="https://github.com/grikomsn/ollama-cloud-copilot-chat/blob/main/LICENSE"><img src="https://img.shields.io/github/license/grikomsn/ollama-cloud-copilot-chat?style=flat-square" alt="MIT license"></a>
</p>

This native VS Code `LanguageModelChatProvider` validates an Ollama API key, discovers hosted models, and streams responses directly from `ollama.com` into Copilot Chat without a local proxy.

## Highlights

- Direct Ollama Cloud integration with no local Ollama installation
- API keys stored in VS Code Secret Storage
- Live discovery with six-hour persisted models.dev enrichment
- Streaming text, separate thinking parts, image inputs, and agent-mode tool calls
- Verified model-specific thinking controls in the model picker
- Published per-model input, cached-input, and output pricing metadata
- Optional Ollama Cloud Web Search tool for agent mode
- Resilient native and fallback token accounting
- Status-bar five-hour and weekly subscription usage

## Quick start

1. Install [Ollama Cloud for GitHub Copilot Chat](https://marketplace.visualstudio.com/items?itemName=grikomsn.ollama-cloud-copilot-chat). You need VS Code 1.125 or newer, GitHub Copilot Chat, and Ollama Cloud access.
2. Create a key in [Ollama API keys](https://ollama.com/settings/keys).
3. Open **Manage Language Models**, choose **Add Models**, select **Ollama Cloud**, name the entry, and paste the key.
4. Repeat the previous step for any additional account or API key, then enable the models you want in Copilot Chat.

Composer controls override workspace defaults; ordered thinking controls default to High and verified binary controls default On. Click the Ollama status-bar item to inspect account utilization, per-model requests, and tokens observed by this extension. Account utilization and local token totals remain separate because Ollama limits are GPU/time based.

## Documentation

- [Setup, commands, settings, and troubleshooting](https://github.com/grikomsn/ollama-cloud-copilot-chat/blob/main/docs/setup.md)
- [Models, thinking, and accounting](https://github.com/grikomsn/ollama-cloud-copilot-chat/blob/main/docs/models.md)
- [API key and security model](https://github.com/grikomsn/ollama-cloud-copilot-chat/blob/main/docs/security.md)
- [Development and releases](https://github.com/grikomsn/ollama-cloud-copilot-chat/blob/main/docs/development.md)

## Related projects

- [Codex Bridge for Copilot Chat](https://github.com/grikomsn/openai-oauth-copilot-chat)
- [Grok for GitHub Copilot Chat](https://github.com/grikomsn/grok-copilot-chat)
- [OpenCode for Copilot Chat](https://github.com/grikomsn/opencode-copilot-chat)
- [Poolside for GitHub Copilot Chat](https://github.com/grikomsn/poolside-copilot-chat)

Unofficial project; not affiliated with Ollama, GitHub, or Microsoft. Ollama account limits and charges still apply. Licensed under [MIT](LICENSE).
