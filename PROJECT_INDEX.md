# PROJECT_INDEX.md

Last updated: 2026-05-05.
Reason: initial GitHub publication.

## What This Project Is

`opencode-proxy` is a local Node.js proxy that lets Anthropic-compatible clients use OpenCode Go's OpenAI-compatible API.

## Repository Status

- Git: yes, local repository expected in this directory.
- Repository type: GitHub publication in progress.
- Remote repository: GitHub.
- Remote URL: `https://github.com/bigdata2211it-web/opencode-proxy` after publish.
- Main branch: `main`.
- Local commits: allowed when useful.
- Push: only by explicit user request. This publication task includes an explicit push request.
- License: no public license selected yet.
- CI/CD: none.

## Read First

- `README.md` - public project entrypoint and usage.
- `index.js` - proxy server and request/response conversion.
- `models.json` - Claude alias to OpenCode Go model mapping.
- `.env.example` - required environment variable names only.

## Important Files

- `index.js` - starts HTTP server, serves `/health`, `/v1/models`, and `/v1/messages`.
- `models.json` - hot-reloaded model aliases.
- `package.json` - Node metadata and simple scripts.
- `.gitignore` - excludes local env files, logs, dependencies, and coverage.

## Runtime

- Node.js 18 or newer.
- Required env name: `OPENCODE_API_KEY`.
- Default local port: `11434`.
- Upstream: `https://opencode.ai/zen/go/v1/chat/completions`.

## Commands

- Start: `node index.js`
- Start on custom port: `node index.js 11435`
- Health check: `curl http://127.0.0.1:11434/health`

## Safety Notes

- Do not commit real `.env` files or API keys.
- README examples must use placeholders only.
- No license has been chosen; public visibility does not grant reuse rights by itself.
