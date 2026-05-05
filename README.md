# OpenCode Proxy

OpenCode Proxy is a small local bridge that lets Anthropic-compatible clients talk to OpenCode Go.

It accepts Anthropic-style requests on `POST /v1/messages`, converts them to OpenAI-style chat completion requests, sends them to OpenCode Go, and converts the response back to the Anthropic shape expected by tools such as Claude Code and Claw.

## What It Does

- Serves a local Anthropic-compatible API on `127.0.0.1:11434`.
- Translates `/v1/messages` requests into `/v1/chat/completions`.
- Supports streaming and non-streaming responses.
- Converts text, system prompts, image blocks, tool calls, and tool results between API formats.
- Exposes `/health` for quick checks.
- Exposes `/v1/models` with OpenCode Go models and Claude-style aliases.
- Reads model aliases from `models.json` and reloads them when the file changes.
- Keeps the real OpenCode API key in `OPENCODE_API_KEY`, outside the repo.

## Why

OpenCode Go uses the OpenAI chat completions format. Some coding clients expect Anthropic's messages format instead. This proxy sits between them:

```text
Claude Code / Claw -> localhost:11434 -> OpenCode Proxy -> OpenCode Go
```

## How Model Mapping Works

The clients are only redirected to a local Anthropic-compatible URL. Nothing else needs to be faked.

For example:

- Claude Code can use `ANTHROPIC_BASE_URL=http://127.0.0.1:11434` in `settings.json`.
- Claw can use a wrapper that exports the same `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY=sk-dummy`.

After that, clients keep sending their normal model names:

- Claude Code may send `claude-sonnet-4-20250514`.
- Claw sends whichever Anthropic model name it selected.

The proxy does the mapping by itself:

```text
claude-sonnet-4-20250514 -> models.json -> deepseek-v4-pro
```

OpenCode Go never sees the original Claude model name. It receives a normal OpenAI-format request with the mapped OpenCode Go model.

In short:

- Clients are told that the Anthropic API is running on localhost.
- The proxy translates Anthropic requests into OpenAI requests.
- The proxy maps Claude-style model names to OpenCode Go model names.
- No other client-side patching is needed.

## Requirements

- Node.js 18 or newer.
- An OpenCode API key in `OPENCODE_API_KEY`.

## Quick Start

```bash
git clone https://github.com/bigdata2211it-web/opencode-proxy.git
cd opencode-proxy

cp .env.example .env
# Edit .env and set OPENCODE_API_KEY.

export OPENCODE_API_KEY=<your-opencode-key>
node index.js
```

The proxy starts on `http://127.0.0.1:11434` by default.

To use another port:

```bash
node index.js 11435
```

## Health Check

```bash
curl http://127.0.0.1:11434/health
```

## Client Setup

Point Anthropic-compatible clients at the local proxy:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:11434
export ANTHROPIC_API_KEY=sk-dummy
```

For Claude-style model names, use aliases such as:

```bash
export ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-20250514
export ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-20250514
export ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-4-20250514
```

## Model Mapping

Edit `models.json` to choose which OpenCode Go model each Claude family should use:

```json
{
  "opus": "qwen3.6-plus",
  "sonnet": "deepseek-v4-pro",
  "haiku": "mimo-v2.5-pro"
}
```

The proxy expands these aliases automatically. For example, `sonnet`, `claude-sonnet-4`, and `claude-sonnet-4-20250514` can all map to the same target model.

Available OpenCode Go models currently listed by the proxy:

```text
glm-5, glm-5.1, kimi-k2.5, kimi-k2.6, minimax-m2.5, minimax-m2.7,
deepseek-v4-flash, deepseek-v4-pro, qwen3.5-plus, qwen3.6-plus,
mimo-v2-pro, mimo-v2-omni, mimo-v2.5, mimo-v2.5-pro
```

## Endpoints

- `HEAD /` and `HEAD /v1` - connection checks.
- `GET /health` - proxy status.
- `GET /v1/models` - available models and aliases.
- `POST /v1/messages` - Anthropic-compatible messages endpoint.

## Environment

Create a local `.env` from `.env.example`, or provide the variable another way:

```bash
OPENCODE_API_KEY=<your-opencode-key>
```

Do not commit `.env`; it is ignored by git.

## Notes

This project is intentionally small: one Node.js entrypoint, one model mapping file, and no external runtime dependencies.
