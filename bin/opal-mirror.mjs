#!/usr/bin/env node
// Small public CLI wrapper for running opal-mirror via npx or a local clone.

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cwd = process.cwd();
const [command = 'help', ...rest] = process.argv.slice(2);

process.env.AI_CHAT_ARCHIVE_DIR ||= path.join(cwd, 'ai-chat-archive');

const commands = {
  doctor: ['doctor.mjs', []],
  sync: ['sync.mjs', rest],
  index: ['build_index.mjs', rest],
  'export-codex': ['export_codex.mjs', rest],
};

if (command === 'help' || command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
}

if (command === 'agent-guide') {
  printAgentGuide();
  process.exit(0);
}

if (!commands[command]) {
  console.error(`Unknown command: ${command}\n`);
  printHelp();
  process.exit(2);
}

const [script, args] = commands[command];
process.argv = ['node', path.join(root, script), ...args];
await import(pathToFileURL(path.join(root, script)).href);

function printHelp() {
  console.log(`opal-mirror

Usage:
  npx github:1va7/opal-mirror doctor
  npx github:1va7/opal-mirror sync [all|claude|chatgpt|gemini|deepseek|doubao|qwen]
  npx github:1va7/opal-mirror index
  npx github:1va7/opal-mirror export-codex [all|chatgpt|claude|gemini|deepseek|doubao|qwen] --codex-home ~/.codex --cwd ~
  npx github:1va7/opal-mirror agent-guide

Notes:
  - Chat archives are written to ./ai-chat-archive by default.
  - Keep ai-chat-archive private; it contains your chat history.
  - Run doctor first. It checks Node, CDP proxy, logged-in browser tabs, and archive paths.
`);
}

function printAgentGuide() {
  console.log(`Agent guide for opal-mirror

Goal:
  Help the user mirror web LLM chat history from their logged-in browser to local files.

Safe default flow:
  1. Run: npx github:1va7/opal-mirror doctor
  2. If Node.js is missing or older than 18, help the user install Node.js 18+.
  3. If Chrome is not running with remote debugging, help the user restart Chrome with --remote-debugging-port=9222.
  4. If the CDP HTTP proxy on localhost:3456 is unavailable, help the user start or provide a compatible CDP HTTP proxy.
  5. Ask the user to log in to the web LLM sites they want mirrored in that Chrome profile.
  6. Re-run doctor until checks are clear enough.
  7. Run: npx github:1va7/opal-mirror sync
  8. If the user uses terminal Codex and asks for /resume import, run:
     npx github:1va7/opal-mirror export-codex chatgpt --codex-home ~/.codex --cwd ~

Privacy rules:
  - Never upload ai-chat-archive, ~/.codex, SQLite files, JSONL files, cookies, tokens, or browser profiles.
  - Do not print secrets or full chat archives into the conversation.
`);
}
