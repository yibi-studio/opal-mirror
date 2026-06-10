# Agent Instructions for opal-mirror

Use this repository as a tool for mirroring a user's web LLM chat history from
their own logged-in browser into local files.

## Fast Path

Run:

```bash
npx github:1va7/opal-mirror doctor
```

Then fix whatever `doctor` reports. When the environment is ready, run:

```bash
npx github:1va7/opal-mirror sync
```

By default, mirrored chats are written to `./ai-chat-archive` in the current
working directory.

## What To Set Up

- Node.js 18 or newer.
- Chrome running with remote debugging enabled, usually on port `9222`.
- A CDP HTTP proxy on `localhost:3456` exposing:
  - `GET /targets`
  - `POST /eval?target=<id>`
  - `GET /new?url=<url>`
  - `GET /navigate?target=<id>&url=<url>`
- The user must be logged in inside that Chrome profile to whichever sites they
  want to mirror.

## Common Commands

```bash
npx github:1va7/opal-mirror doctor
npx github:1va7/opal-mirror sync
npx github:1va7/opal-mirror sync chatgpt
npx github:1va7/opal-mirror sync claude
npx github:1va7/opal-mirror sync gemini
npx github:1va7/opal-mirror sync deepseek
npx github:1va7/opal-mirror sync doubao
npx github:1va7/opal-mirror sync qwen
npx github:1va7/opal-mirror index
```

For terminal Codex `/resume` import:

```bash
npx github:1va7/opal-mirror export-codex chatgpt --codex-home ~/.codex --cwd ~
```

## Privacy Rules

- Do not upload or commit `ai-chat-archive`, `.codex`, SQLite files, JSONL files,
  browser profiles, cookies, tokens, or credentials.
- Do not paste full chat archives into the conversation.
- If showing examples, use redacted or synthetic data.
- Treat mirrored archives as private user data.

