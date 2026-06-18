#!/usr/bin/env node
// Validate Codex /resume export with a temporary archive and Codex home.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPORT = path.join(__dirname, 'export_codex.mjs');

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'opal-codex-export-'));
const archive = path.join(tmp, 'archive');
const codexHome = path.join(tmp, 'codex-home');
const cwd = path.join(tmp, 'workspace');
const results = [];

const pass = (name, msg = '') => { results.push({ ok: true, name }); console.log(`  ✓ ${name}${msg ? ' — ' + msg : ''}`); };
const fail = (name, msg = '') => { results.push({ ok: false, name, msg }); console.log(`  ✗ ${name}${msg ? ' — ' + msg : ''}`); };
const assert = (condition, name, msg = '') => condition ? pass(name, msg) : fail(name, msg);

async function writeJSON(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

async function setup() {
  await fs.mkdir(codexHome, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });
  await writeJSON(path.join(archive, 'chatgpt', 'cg-1.json'), {
    conversation_id: 'cg-1',
    title: 'ChatGPT multi turn',
    create_time: 1704067200,
    update_time: 1704067380,
    current_node: 'a2',
    mapping: {
      root: { id: 'root', parent: null, children: ['u1'] },
      u1: {
        id: 'u1',
        parent: 'root',
        children: ['a1'],
        message: { author: { role: 'user' }, create_time: 1704067200, content: { parts: ['first question'] } },
      },
      a1: {
        id: 'a1',
        parent: 'u1',
        children: ['u2'],
        message: { author: { role: 'assistant' }, create_time: 1704067260, content: { parts: ['first answer'] } },
      },
      u2: {
        id: 'u2',
        parent: 'a1',
        children: ['a2'],
        message: { author: { role: 'user' }, create_time: 1704067320, content: { parts: ['second question'] } },
      },
      a2: {
        id: 'a2',
        parent: 'u2',
        children: [],
        message: { author: { role: 'assistant' }, create_time: 1704067380, content: { parts: ['second answer'] } },
      },
    },
  });
  await writeJSON(path.join(archive, 'claude', 'cl-1.json'), {
    uuid: 'cl-1',
    name: 'Claude one turn',
    created_at: '2024-02-01T00:00:00.000Z',
    updated_at: '2024-02-01T00:01:00.000Z',
    chat_messages: [
      { sender: 'human', text: 'claude user', created_at: '2024-02-01T00:00:00.000Z', index: 0 },
      { sender: 'assistant', text: 'claude assistant', created_at: '2024-02-01T00:01:00.000Z', index: 1 },
    ],
  });
  await writeJSON(path.join(archive, 'gemini', 'gm-1.json'), {
    id: 'gm-1',
    title: 'Gemini one turn',
    synced_at: '2024-03-01T00:00:00.000Z',
    turns: [
      { role: 'user', text: 'gemini user' },
      { role: 'model', text: 'gemini assistant' },
    ],
  });
  await writeJSON(path.join(archive, 'deepseek', 'ds-1.json'), {
    id: 'ds-1',
    title: 'DeepSeek one turn',
    inserted_at: 1709251200,
    updated_at: 1709251260,
    chat_messages: [
      { role: 'USER', content: 'deepseek user', created_at: 1709251200, message_index: 1 },
      { role: 'ASSISTANT', content: 'deepseek assistant', created_at: 1709251260, message_index: 2 },
    ],
  });
  await writeJSON(path.join(archive, 'doubao', 'db-1.json'), {
    conversation_id: 'db-1',
    name: 'Doubao one turn',
    update_time: 1709337660,
    messages: [
      { user_type: 1, index_in_conv: 1, create_time: 1709337600, content_block: [{ content: { text_block: { text: 'doubao user' } } }] },
      { user_type: 2, index_in_conv: 2, create_time: 1709337660, content_block: [{ content: { text_block: { text: 'doubao assistant' } } }] },
    ],
  });
  await writeJSON(path.join(archive, 'qwen', 'qw-1.json'), {
    session_id: 'qw-1',
    title: 'Qwen one turn',
    created_at: 1709424000000,
    updated_at: 1709424060000,
    records: [
      {
        created_at: 1709424000000,
        request_messages: [{ content: 'qwen user' }],
        response_messages: [{ content: 'qwen assistant' }],
      },
    ],
  });
}

function runExport(extraArgs = []) {
  return spawnSync('node', [
    EXPORT,
    'all',
    '--archive', archive,
    '--codex-home', codexHome,
    '--cwd', cwd,
    ...extraArgs,
  ], { encoding: 'utf8' });
}

function runExportDefaultCwd(extraArgs = []) {
  return spawnSync('node', [
    EXPORT,
    'all',
    '--archive', archive,
    '--codex-home', codexHome,
    ...extraArgs,
  ], { encoding: 'utf8' });
}

async function listRollouts() {
  const out = [];
  async function walk(dir) {
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.jsonl')) out.push(full);
    }
  }
  await walk(path.join(codexHome, 'sessions'));
  return out.sort();
}

async function readJsonl(file) {
  return (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function sqliteAvailable() {
  return spawnSync('sqlite3', ['--version'], { encoding: 'utf8' }).status === 0;
}

console.log(`\nTesting Codex export with temp root: ${tmp}\n`);
await setup();

if (sqliteAvailable()) {
  const create = spawnSync('sqlite3', [path.join(codexHome, 'state_5.sqlite')], {
    input: `CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      source TEXT,
      model_provider TEXT,
      cwd TEXT,
      title TEXT,
      sandbox_policy TEXT,
      approval_mode TEXT,
      tokens_used INTEGER,
      has_user_event INTEGER,
      archived INTEGER,
      archived_at INTEGER,
      git_sha TEXT,
      git_branch TEXT,
      git_origin_url TEXT,
      cli_version TEXT,
      first_user_message TEXT,
      agent_nickname TEXT,
      agent_role TEXT,
      memory_mode TEXT,
      model TEXT,
      reasoning_effort TEXT,
      agent_path TEXT,
      created_at_ms INTEGER,
      updated_at_ms INTEGER,
      thread_source TEXT,
      preview TEXT
    );\n`,
    encoding: 'utf8',
  });
  assert(create.status === 0, 'sqlite fixture created', create.stderr.trim());
} else {
  pass('sqlite fixture skipped', 'sqlite3 not available');
}

const first = runExport();
assert(first.status === 0, 'export command succeeds', first.stderr.trim() || first.stdout.trim().split('\n').at(-1));

const files = await listRollouts();
assert(files.length === 6, 'rollout files written', `${files.length} sessions`);
const metaRows = await Promise.all(files.map(async file => (await readJsonl(file))[0]));
assert(metaRows.every(row => row?.payload?.cwd === cwd), 'explicit cwd preserved');

let malformed = 0;
let totalAgent = 0;
let totalAssistantResponse = 0;
let chatgptOk = false;
for (const file of files) {
  const rows = await readJsonl(file);
  const meta = rows[0];
  const taskStarted = rows.filter(r => r.type === 'event_msg' && r.payload?.type === 'task_started').length;
  const userMessages = rows.filter(r => r.type === 'event_msg' && r.payload?.type === 'user_message').length;
  const agentMessages = rows.filter(r => r.type === 'event_msg' && r.payload?.type === 'agent_message').length;
  const assistantResponses = rows.filter(r => r.type === 'response_item' && r.payload?.role === 'assistant').length;
  totalAgent += agentMessages;
  totalAssistantResponse += assistantResponses;
  if (meta?.type !== 'session_meta' || taskStarted < 1 || userMessages < 1 || agentMessages < 1 || agentMessages !== assistantResponses) malformed++;
  if (meta?.payload?.thread_name === '[webchat:chatgpt] ChatGPT multi turn') {
    chatgptOk = taskStarted === 2 && userMessages === 2 && agentMessages === 2 && rows.some(r => r.payload?.message === 'second answer');
    const stat = await fs.stat(file);
    const mtimeMs = Math.round(stat.mtimeMs / 1000) * 1000;
    const expected = Date.parse('2024-01-01T00:03:00.000Z');
    assert(Math.abs(mtimeMs - expected) <= 1000, 'webchat mtime preserved', stat.mtime.toISOString());
  }
}
assert(malformed === 0, 'rollout schema includes visible assistant messages', `agent=${totalAgent}, response=${totalAssistantResponse}`);
assert(chatgptOk, 'ChatGPT multi-turn transcript complete');

const indexBefore = await fs.readFile(path.join(codexHome, 'session_index.jsonl'), 'utf8');
const historyBefore = await fs.readFile(path.join(codexHome, 'history.jsonl'), 'utf8');
const second = runExport();
assert(second.status === 0, 'repeat export succeeds');
const indexAfter = await fs.readFile(path.join(codexHome, 'session_index.jsonl'), 'utf8');
const historyAfter = await fs.readFile(path.join(codexHome, 'history.jsonl'), 'utf8');
assert(indexAfter === indexBefore && historyAfter === historyBefore, 'legacy indexes are idempotent');

if (sqliteAvailable()) {
  const count = spawnSync('sqlite3', [path.join(codexHome, 'state_5.sqlite'), "select count(*) from threads where title like '[webchat:%';"], { encoding: 'utf8' });
  assert(count.status === 0 && count.stdout.trim() === '6', 'sqlite threads registered', count.stdout.trim());
  const row = spawnSync('sqlite3', [path.join(codexHome, 'state_5.sqlite'), "select updated_at_ms, thread_source from threads where title='[webchat:chatgpt] ChatGPT multi turn';"], { encoding: 'utf8' });
  assert(row.stdout.trim() === '1704067380000|user', 'sqlite timestamp/thread_source preserved', row.stdout.trim());
  const chatgptPath = spawnSync('sqlite3', [path.join(codexHome, 'state_5.sqlite'), "select rollout_path from threads where title='[webchat:chatgpt] ChatGPT multi turn' limit 1;"], { encoding: 'utf8' }).stdout.trim();
  const dup = spawnSync('sqlite3', [path.join(codexHome, 'state_5.sqlite')], {
    input: `insert into threads (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title, sandbox_policy, approval_mode, tokens_used, has_user_event, archived, cli_version, first_user_message, memory_mode, model, created_at_ms, updated_at_ms, thread_source, preview) values ('legacy-duplicate-id', '${chatgptPath.replace(/'/g, "''")}', 1704067200, 1704067380, 'cli', 'metana', '${cwd.replace(/'/g, "''")}', '[webchat:chatgpt] ChatGPT multi turn', '{"type":"disabled"}', 'never', 0, 1, 0, '0.135.0', 'first question', 'enabled', 'gpt-5.5', 1704067200000, 1704067380000, 'user', 'first question');\n`,
    encoding: 'utf8',
  });
  assert(dup.status === 0, 'sqlite duplicate fixture inserted');
  const third = runExport();
  assert(third.status === 0 && third.stdout.includes('pruned 1 duplicate'), 'duplicate sqlite webchat row pruned', third.stdout.trim().split('\n').at(-2) || third.stdout.trim());
  const countAfterPrune = spawnSync('sqlite3', [path.join(codexHome, 'state_5.sqlite'), "select count(*) from threads where title like '[webchat:%';"], { encoding: 'utf8' });
  assert(countAfterPrune.stdout.trim() === '6', 'sqlite webchat count stable after prune', countAfterPrune.stdout.trim());
}

await fs.rm(path.join(codexHome, 'sessions'), { recursive: true, force: true });
await fs.rm(path.join(codexHome, 'session_index.jsonl'), { force: true });
await fs.rm(path.join(codexHome, 'history.jsonl'), { force: true });
const defaultCwdExport = runExportDefaultCwd(['--no-state']);
assert(defaultCwdExport.status === 0, 'default cwd export succeeds', defaultCwdExport.stderr.trim());
const defaultFiles = await listRollouts();
const defaultRows = await Promise.all(defaultFiles.map(async file => (await readJsonl(file))[0]));
const expectedDefaultCwd = path.join(codexHome, 'webchat-imports');
assert(defaultRows.length === 6 && defaultRows.every(row => row?.payload?.cwd === expectedDefaultCwd), 'default cwd is webchat-imports', expectedDefaultCwd);

console.log('\n=== SUMMARY ===');
const passed = results.filter(r => r.ok).length;
const failed = results.length - passed;
console.log(`${passed} passed / ${failed} failed`);
for (const r of results.filter(r => !r.ok)) console.log(`  FAIL: ${r.name} — ${r.msg}`);

await fs.rm(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
