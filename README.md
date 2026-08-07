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

This extension is a native VS Code `LanguageModelChatProvider`. It validates an Ollama API key, discovers the hosted models available to your account, and streams responses directly from `ollama.com` into Copilot Chat without a local proxy.

## Highlights

- Direct Ollama Cloud integration with no Ollama app, CLI, or local models
- API keys stored in VS Code Secret Storage
- Live model discovery enriched with context length, modality, and tool metadata
- Streaming text and separate thinking parts
- Verified model-specific thinking controls in the Copilot Chat model picker
- Image inputs and agent-mode tool calls where supported
- Resilient response token accounting for Copilot's context indicator
- Status-bar indicator for five-hour and weekly subscription usage

## Quick start

1. Install [Ollama Cloud for GitHub Copilot Chat](https://marketplace.visualstudio.com/items?itemName=grikomsn.ollama-cloud-copilot-chat). You need VS Code 1.125 or newer, GitHub Copilot Chat, and an Ollama account with Cloud API access.
2. Create a key in [Ollama API keys](https://ollama.com/settings/keys).
3. Run **Ollama Cloud: Configure API Key** from the Command Palette.
4. Open Copilot Chat, select **Manage Models**, enable **Ollama Cloud**, then choose a hosted model.

Click the Ollama status-bar item or run **Ollama Cloud: Show Subscription Usage** to inspect exact five-hour and weekly utilization, per-model request counts, and tokens observed by this extension. Ollama's account limits are GPU/time based rather than token quotas, so account utilization and local token totals are shown separately.

Request totals use Ollama's native token counts when available. If a completed stream omits either count, the extension estimates only the missing value so VS Code does not incorrectly reset the conversation context indicator to zero.

Use **Ollama Cloud: Manage Connection** to test inference, refresh models, replace or remove the key, inspect usage and logs, or create a secret-safe diagnostic snapshot.

## Documentation

- [Setup, commands, settings, and troubleshooting](https://github.com/grikomsn/ollama-cloud-copilot-chat/blob/main/docs/setup.md)
- [Models, capabilities, thinking, and accounting](https://github.com/grikomsn/ollama-cloud-copilot-chat/blob/main/docs/models.md)
- [API key and security model](https://github.com/grikomsn/ollama-cloud-copilot-chat/blob/main/docs/security.md)
- [Development and releases](https://github.com/grikomsn/ollama-cloud-copilot-chat/blob/main/docs/development.md)

## Related projects

- [Grok for GitHub Copilot Chat](https://github.com/grikomsn/grok-copilot-chat) — Use xAI Grok models directly from the Copilot Chat model picker.
- [Codex Bridge for Copilot Chat](https://github.com/grikomsn/openai-oauth-copilot-chat) — Use OpenAI Codex models with a ChatGPT Plus or Pro subscription.
- [Poolside for GitHub Copilot Chat](https://github.com/grikomsn/poolside-copilot-chat) — Use hosted Poolside coding models directly from Copilot Chat.

Unofficial project; not affiliated with Ollama, GitHub, or Microsoft. Ollama account limits and charges still apply. Licensed under [MIT](LICENSE).
