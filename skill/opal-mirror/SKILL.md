---
name: opal-mirror
description: This skill should be used when the user asks to sync, mirror, import, bootstrap, initialize, or migrate web LLM chat history from ChatGPT, Claude, Gemini, DeepSeek, Doubao, or Qwen into local files or Codex /resume sessions; trigger phrases include "同步网页端大模型聊天记录", "把 ChatGPT 历史导入本地 Agent", "让 Agent 认识我", "opal-mirror", "web chat to Codex resume", and "主人档案初始化".
version: 0.2.0
---

# opal-mirror Skill

Use this skill to initialize a local Agent with the user's existing web LLM chat history, then optionally import those conversations into terminal Codex `/resume` and Codex App sessions.

The skill is intentionally lightweight for skill-hub distribution: it ships the onboarding/helper wrapper and the approved CDP proxy, then clones/updates the real `opal-mirror` repo during first-run bootstrap. Use `/Users/va7/Desktop/opal-mirror` when that dev clone exists; otherwise the product install path is `~/.local/share/opal-mirror`.

In commands below, resolve `scripts/opal_mirror_skill.sh` relative to this `SKILL.md` directory. In a normal Codex install that path is usually `~/.codex/skills/opal-mirror/scripts/opal_mirror_skill.sh`.

## Core Positioning

Treat opal-mirror as an Agent initialization workflow, not as a generic export tutorial.

The intended user outcome is:

> A newly installed local Agent can read or resume the user's previous web LLM conversations across terminal Codex and Codex App, so it can understand what the user has been doing and what context already exists.

Avoid turning the workflow into README narration. Prefer operating the tool and reporting concise status.

## Privacy Rules

Never upload, commit, or paste private data from:

- `ai-chat-archive/`
- `~/.codex/`
- `state_5.sqlite` or SQLite backups
- Codex rollout `.jsonl` files
- Browser profiles, cookies, tokens, localStorage values, or credentials
- Full mirrored chat JSON

When showing examples, use filenames, counts, titles only when safe, and short redacted snippets if absolutely necessary.

## First-Run Onboarding

When a user invokes this skill for the first time, do not explain the README. Run the bootstrap wrapper:

```bash
scripts/opal_mirror_skill.sh bootstrap chatgpt
```

Use `all` only when the user explicitly wants every supported platform checked:

```bash
scripts/opal_mirror_skill.sh bootstrap all
```

Bootstrap does all of the following:

- Ensures `git` and Node.js 18+ exist.
- Clones `https://github.com/1va7/opal-mirror.git` to `~/.local/share/opal-mirror` if no dev clone or `OPAL_MIRROR_REPO` is present.
- Runs `npm install` in the repo.
- Starts/checks the bundled approved CDP proxy against the user's main Chrome profile.
- Runs repo `doctor.mjs`.

If Chrome is not running, the helper may start the normal main Chrome profile with `--remote-debugging-port=9222`. If Chrome is already running but remote debugging is not reachable, stop and ask the user to quit Chrome completely and relaunch the same main profile with:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

Do not add `--user-data-dir`; that creates the wrong profile.

If Chrome refuses remote debugging on the default profile and prints `DevTools remote debugging requires a non-default data directory`, stop. Do not create, suggest, or switch to another `--user-data-dir`; that would lose the user's existing login state and violate the main-profile rule.

If bootstrap succeeds, ask the user how many recent conversations to import. Then run the bounded workflow:

```bash
scripts/opal_mirror_skill.sh import-codex-limited chatgpt 20
```

Never run an unbounded sync from the skill wrapper. This skill is not a background auto-sync daemon; every sync/import is manually triggered by the user or by an agent acting on an explicit user request.

Codex import writes two local mirrors for each web chat:

- `source=cli` for terminal Codex `/resume`.
- `source=vscode` for Codex App sidebar/search.

Both mirrors preserve the original web-chat session times in SQLite, rollout JSONL timestamps, rollout file mtimes, and Codex App thread-id time prefixes. Imported titles use `[webchat:<platform>]` so they can be distinguished from native Codex App conversations.

## Standard Workflow

## Chrome Profile / Account Rules

Use the user's already logged-in primary Chrome/profile. This is mandatory.
Do not create a fresh Chrome profile, temporary `--user-data-dir`, isolated
browser instance, or alternate Chrome debug port to sync web LLM history,
because that loses the user's cookies, account, and chat history.

If CDP is broken or unreachable, fix or restart CDP against the user's existing
logged-in Chrome profile. Do not work around it by opening a new profile unless
the user explicitly asks for that.

Do not create ad-hoc CDP proxy implementations. Use only the bundled approved
proxy script at:

```bash
scripts/cdp_proxy.mjs
```

Manage CDP through the opal-mirror helper only:

```bash
scripts/opal_mirror_skill.sh cdp-cleanup
scripts/opal_mirror_skill.sh cdp-start-main
scripts/opal_mirror_skill.sh cdp-status
```

`cdp-cleanup` may remove temporary opal-created profiles/proxies. It must not
kill the user's main Chrome profile. `cdp-start-main` starts the approved proxy
against the main Chrome profile's `DevToolsActivePort`.

Before any `sync`, `sync-limited`, `import-codex-limited`, or `bootstrap-codex`,
the helper script enforces these checks. Do not bypass the helper with raw
commands unless debugging the helper itself.

If multiple Chrome profiles, ChatGPT accounts, or same-platform logged-in tabs
are visible, stop and ask the user which account/profile/target to use before
syncing. Report only safe identifiers such as page title, hostname, and redacted
account label when available; never print cookies or tokens.

Before syncing a provider, verify the selected tab is logged in for the intended
account. For ChatGPT, a tab that is open but not logged in is not acceptable for
sync.

For environment checks after bootstrap, use the helper script:

```bash
scripts/opal_mirror_skill.sh doctor
```

Read the output and fix prerequisites in this order:

1. Node.js 18+.
2. User's main Chrome profile running with remote debugging enabled.
3. Approved CDP HTTP proxy reachable at `http://localhost:3456`, unless `CDP_PROXY` is set.
4. Logged-in Chrome tabs for the platforms the user wants to mirror.
5. Writable archive directory.

After the environment is ready enough, ask the user how many recent conversations to import. Do not run an unbounded sync by default.

For normal user requests, run the complete import workflow. For example, if the user wants 20 recent ChatGPT conversations imported into Codex `/resume`, run:

```bash
scripts/opal_mirror_skill.sh import-codex-limited chatgpt 20
```

This runs `doctor`, limited `sync`, `index`, limited `export-codex`, repairs Codex App frontend state when possible, then verifies recent `/resume` rows. It writes mirrored chats to `/Users/va7/Desktop/opal-mirror/ai-chat-archive` by default, unless `AI_CHAT_ARCHIVE_DIR` is already set.

If Codex App is running, sidebar registry repair is deferred because the app can overwrite external global-state edits on shutdown. In that case, fully quit Codex App and run:

```bash
scripts/opal_mirror_skill.sh repair-codex-app --codex-home ~/.codex
```

The repair command also fixes Codex App rollout mtimes from SQLite `updated_at_ms`, so App-side imported sessions sort by the original web-chat time instead of import time.

Build or refresh the readable index:

```bash
scripts/opal_mirror_skill.sh index
```

For terminal Codex `/resume` plus Codex App import, run:

```bash
scripts/opal_mirror_skill.sh export-codex all --codex-home ~/.codex --cwd ~
```

For a full Agent initialization pass after the user gives a count, run:

```bash
scripts/opal_mirror_skill.sh bootstrap-codex chatgpt --limit 20 --codex-home ~/.codex --cwd ~
```

`bootstrap-codex` runs `doctor`, limited `sync`, `index`, then `export-codex`.

## Platform Targets

Use `all` by default. Use a specific platform only when the user asks or when debugging one provider:

- `claude`
- `chatgpt`
- `gemini`
- `deepseek`
- `doubao`
- `qwen`

Examples:

```bash
scripts/opal_mirror_skill.sh import-codex-limited chatgpt 20
scripts/opal_mirror_skill.sh import-codex-limited gemini 5
scripts/opal_mirror_skill.sh sync chatgpt --limit 20
scripts/opal_mirror_skill.sh sync-limited chatgpt 20
scripts/opal_mirror_skill.sh export-codex chatgpt --codex-home ~/.codex --cwd ~
```

Treat `sync` and `sync-limited` as debugging or archive-only commands. When the user asks to "导入" or expects `/resume`, use `import-codex-limited`.

## Handling Common Failures

If `doctor` reports no CDP proxy, explain that opal-mirror expects a small HTTP wrapper around Chrome DevTools Protocol with:

- `GET /targets`
- `POST /eval?target=<id>`
- `GET /new?url=<url>`
- `GET /navigate?target=<id>&url=<url>`

If Chrome remote debugging is not enabled on macOS, suggest closing Chrome and launching:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

If the helper says Chrome is already running but the debug port is unreachable, that is expected: Chrome must be fully quit and relaunched with the command above. Do not start a second profile or temporary Chrome to work around this.

If Chrome refuses the default profile for CDP, report that the current Chrome policy blocks opal-mirror's main-profile workflow. Do not work around it with another profile.

If a platform tab is missing or not logged in, ask the user to open that site in the debugged Chrome profile and log in, then rerun `doctor`.

If ChatGPT hits rate limits during first full sync, treat it as expected. opal-mirror uses throttling/backoff; rerun later to continue.

If Gemini returns incomplete history, explain that Gemini's web sidebar may not expose older conversations and Google Takeout may be needed for full historical coverage.

## Demo Guidance

For video demos, show the workflow as "Agent initializes its owner profile":

1. Browser on the left with a web LLM history page open.
2. Agent TUI on the right.
3. Ask the Agent: "用 opal-mirror 同步我的网页端大模型聊天记录，并导入 Codex /resume。"
4. Run the skill workflow.
5. Open `/resume` and show imported `[webchat:<platform>]` sessions.

Do not spend demo time reading README commands aloud. Narrate the result: previous web conversations are now local Agent sessions.

## Additional References

- Local repo: `/Users/va7/Desktop/opal-mirror`
- Main README: `/Users/va7/Desktop/opal-mirror/README.md`
- Agent guide: run `node /Users/va7/Desktop/opal-mirror/bin/opal-mirror.mjs agent-guide`
- Helper script: `scripts/opal_mirror_skill.sh`
