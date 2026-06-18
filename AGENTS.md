# Agent Instructions for opal-mirror

Use this repository as a tool for mirroring a user's web LLM chat history from
their own logged-in browser into local files.

## Fast Path

Prefer the bundled skill wrapper because it enforces onboarding, main Chrome
profile usage, and bounded sync:

```bash
skill/opal-mirror/scripts/opal_mirror_skill.sh bootstrap chatgpt
```

Then ask the user how many recent conversations to import. When the environment
is ready, run a bounded import:

```bash
skill/opal-mirror/scripts/opal_mirror_skill.sh import-codex-limited chatgpt 20
```

Do not run an unbounded sync unless the user explicitly requests a full archive.
By default, mirrored chats are written to `./ai-chat-archive` in the repo or to
the skill wrapper's selected product repo.

## What To Set Up

- Node.js 18 or newer.
- The user's already logged-in main Chrome profile running with remote debugging
  enabled, usually on port `9222`.
- A CDP HTTP proxy on `localhost:3456` exposing:
  - `GET /targets`
  - `POST /eval?target=<id>`
  - `GET /new?url=<url>`
  - `GET /navigate?target=<id>&url=<url>`
- The user must be logged in inside that Chrome profile to whichever sites they
  want to mirror.
- Never create a fresh Chrome profile, temporary `--user-data-dir`, isolated
  browser, or ad-hoc CDP proxy to work around login/CDP problems.
- If Chrome refuses CDP on the default profile, stop and report that the current
  Chrome policy blocks opal-mirror's main-profile workflow. Do not work around it
  with another profile.

## Common Commands

```bash
npx github:1va7/opal-mirror doctor
npx github:1va7/opal-mirror sync --limit 20
npx github:1va7/opal-mirror sync chatgpt --limit 20
npx github:1va7/opal-mirror sync claude --limit 20
npx github:1va7/opal-mirror sync gemini --limit 20
npx github:1va7/opal-mirror sync deepseek --limit 20
npx github:1va7/opal-mirror sync doubao --limit 20
npx github:1va7/opal-mirror sync qwen --limit 20
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
