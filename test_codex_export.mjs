#!/usr/bin/env node
// Validate Codex /resume export with a temporary archive and Codex home.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPORT = path.join(__dirname, 'export_codex.mjs');
const REPAIR = path.join(__dirname, 'repair_codex_app_frontend.mjs');

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'opal-codex-export-'));
const archive = path.join(tmp, 'archive');
const codexHome = path.join(tmp, 'codex-home');
const cwd = path.join(tmp, 'workspace');
const appCwd = path.join(os.homedir(), 'Documents', 'Codex');
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
  await writeJSON(path.join(codexHome, '.codex-global-state.json'), {
    'projectless-thread-ids': ['existing-thread'],
    'thread-workspace-root-hints': { 'existing-thread': appCwd },
    'thread-projectless-output-directories': { 'existing-thread': path.join(appCwd, 'existing', 'outputs') },
    'electron-persisted-atom-state': {
      'heartbeat-thread-permissions-by-id': {
        'existing-thread': {
          approvalPolicy: 'never',
          approvalsReviewer: 'user',
          sandboxPolicy: { type: 'dangerFullAccess' },
        },
      },
    },
  });
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

function runExport(extraArgs = [], extraEnv = {}) {
  return spawnSync('node', [
    EXPORT,
    'all',
    '--archive', archive,
    '--codex-home', codexHome,
    '--cwd', cwd,
    ...extraArgs,
  ], { encoding: 'utf8', env: { ...process.env, ...extraEnv } });
}

function runExportDefaultCwd(extraArgs = [], extraEnv = {}) {
  return spawnSync('node', [
    EXPORT,
    'all',
    '--archive', archive,
    '--codex-home', codexHome,
    ...extraArgs,
  ], { encoding: 'utf8', env: { ...process.env, ...extraEnv } });
}

function runRepair(extraArgs = [], extraEnv = {}) {
  return spawnSync('node', [
    REPAIR,
    '--archive', archive,
    '--codex-home', codexHome,
    '--json',
    ...extraArgs,
  ], { encoding: 'utf8', env: { ...process.env, ...extraEnv } });
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

async function removeAppFrontendIds(ids) {
  const stateFile = path.join(codexHome, '.codex-global-state.json');
  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  const idSet = new Set(ids);
  state['projectless-thread-ids'] = (state['projectless-thread-ids'] || []).filter(id => !idSet.has(id));
  for (const id of ids) {
    delete state['thread-workspace-root-hints']?.[id];
    delete state['thread-projectless-output-directories']?.[id];
    delete state['electron-persisted-atom-state']?.['heartbeat-thread-permissions-by-id']?.[id];
  }
  await fs.writeFile(stateFile, `${JSON.stringify(state)}\n`, 'utf8');
}

async function readGlobalState() {
  return JSON.parse(await fs.readFile(path.join(codexHome, '.codex-global-state.json'), 'utf8'));
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
assert(files.length === 12, 'rollout files written', `${files.length} sessions`);
const metaRows = await Promise.all(files.map(async file => (await readJsonl(file))[0]));
const terminalMetaRows = metaRows.filter(row => row?.payload?.metadata?.imported_by === 'opal-mirror' && row?.payload?.source === 'cli');
const appMetaRows = metaRows.filter(row => row?.payload?.metadata?.imported_by === 'opal-mirror' && row?.payload?.source === 'vscode');
assert(terminalMetaRows.length === 6 && terminalMetaRows.every(row => row?.payload?.cwd === cwd), 'explicit terminal cwd preserved');
assert(appMetaRows.length === 6 && appMetaRows.every(row => row?.payload?.cwd === appCwd), 'App mirror cwd registered');
const appThreadIds = Object.values(JSON.parse(await fs.readFile(path.join(archive, '_codex_app_thread_ids.json'), 'utf8')));
const appThreadIdMap = JSON.parse(await fs.readFile(path.join(archive, '_codex_app_thread_ids.json'), 'utf8'));
const globalState = JSON.parse(await fs.readFile(path.join(codexHome, '.codex-global-state.json'), 'utf8'));
const projectlessIds = globalState['projectless-thread-ids'];
const appFrontendOk = appThreadIds.length === 6
  && appThreadIds.every(id => projectlessIds.includes(id))
  && projectlessIds[0] === 'existing-thread'
  && appThreadIds.every(id => globalState['thread-workspace-root-hints'][id] === appCwd)
  && appThreadIds.every(id => globalState['thread-projectless-output-directories'][id] === path.join(appCwd, 'webchat-imports', id, 'outputs'))
  && appThreadIds.every(id => globalState['electron-persisted-atom-state']['heartbeat-thread-permissions-by-id'][id]?.sandboxPolicy?.type === 'dangerFullAccess');
assert(appFrontendOk, 'App frontend registry populated');

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
    if (meta?.payload?.source === 'cli') assert(Math.abs(mtimeMs - expected) <= 1000, 'terminal webchat mtime preserved', stat.mtime.toISOString());
    if (meta?.payload?.source === 'vscode') assert(Math.abs(mtimeMs - expected) <= 1000, 'App webchat mtime preserved', stat.mtime.toISOString());
  }
}
assert(malformed === 0, 'rollout schema includes visible assistant messages', `agent=${totalAgent}, response=${totalAssistantResponse}`);
assert(chatgptOk, 'ChatGPT multi-turn transcript complete');
const appCgId = appThreadIdMap['webchat:chatgpt:cg-1'];
assert(typeof appCgId === 'string' && appCgId.startsWith('018cc251-f400-'), 'App mirror id timestamp prefix uses source start time', appCgId);
assert(appMetaRows.every(row => row?.payload?.metadata?.mirror_target === 'codex_app'), 'App metadata marks mirror target');
assert(terminalMetaRows.every(row => row?.payload?.metadata?.mirror_target === 'terminal'), 'terminal metadata marks mirror target');

const indexBefore = await fs.readFile(path.join(codexHome, 'session_index.jsonl'), 'utf8');
const historyBefore = await fs.readFile(path.join(codexHome, 'history.jsonl'), 'utf8');
const second = runExport();
assert(second.status === 0, 'repeat export succeeds');
const indexAfter = await fs.readFile(path.join(codexHome, 'session_index.jsonl'), 'utf8');
const historyAfter = await fs.readFile(path.join(codexHome, 'history.jsonl'), 'utf8');
assert(indexAfter === indexBefore && historyAfter === historyBefore, 'legacy indexes are idempotent');
const globalStateAfter = JSON.parse(await fs.readFile(path.join(codexHome, '.codex-global-state.json'), 'utf8'));
assert(appThreadIds.every(id => globalStateAfter['projectless-thread-ids'].filter(existing => existing === id).length === 1), 'App frontend registry is idempotent');
const reset = runExport(['--reset-app-ids']);
assert(reset.status === 0, 'App id reset export succeeds', reset.stderr.trim());
const resetThreadIds = Object.values(JSON.parse(await fs.readFile(path.join(archive, '_codex_app_thread_ids.json'), 'utf8')));
const resetGlobalState = JSON.parse(await fs.readFile(path.join(codexHome, '.codex-global-state.json'), 'utf8'));
assert(
  resetThreadIds.length === 6
    && resetThreadIds.every(id => resetGlobalState['projectless-thread-ids'].includes(id))
    && appThreadIds.every(id => !resetGlobalState['projectless-thread-ids'].includes(id))
    && resetThreadIds.some((id, i) => id !== appThreadIds[i]),
  'App id reset replaces frontend registry ids',
);

await removeAppFrontendIds(resetThreadIds);
const resetAppRows = spawnSync('sqlite3', [path.join(codexHome, 'state_5.sqlite'), '-json', "select rollout_path, updated_at_ms from threads where source='vscode' and title like '[webchat:%';"], { encoding: 'utf8' });
if (resetAppRows.status === 0 && resetAppRows.stdout.trim()) {
  for (const row of JSON.parse(resetAppRows.stdout)) {
    const now = Date.now() / 1000;
    await fs.utimes(row.rollout_path, now, now);
  }
  const mtimeRepair = runRepair(['--fix-mtime-only'], {
    OPAL_MIRROR_ASSUME_REAL_CODEX_HOME: '1',
    OPAL_MIRROR_ASSUME_CODEX_APP_RUNNING: '1',
  });
  let mtimeRepairResult = {};
  try { mtimeRepairResult = JSON.parse(mtimeRepair.stdout); } catch {}
  assert(mtimeRepair.status === 0 && mtimeRepairResult.mtimes?.changed === 6, 'mtime-only repair works while Codex App is running', mtimeRepair.stdout.trim() || mtimeRepair.stderr.trim());
}
const repair = runRepair();
let repairResult = {};
try { repairResult = JSON.parse(repair.stdout); } catch {}
assert(repair.status === 0 && repairResult.status === 'repaired' && repairResult.missingBefore === 6, 'repair restores missing App frontend registry', repair.stdout.trim() || repair.stderr.trim());
const repairedState = await readGlobalState();
assert(resetThreadIds.every(id => repairedState['projectless-thread-ids'].includes(id)), 'repair registers all App mirror ids');
const repairAgain = runRepair();
let repairAgainResult = {};
try { repairAgainResult = JSON.parse(repairAgain.stdout); } catch {}
assert(repairAgain.status === 0 && repairAgainResult.status === 'ok', 'repair is idempotent', repairAgain.stdout.trim() || repairAgain.stderr.trim());

await removeAppFrontendIds(resetThreadIds);
const deferredExport = runExport([], {
  OPAL_MIRROR_ASSUME_REAL_CODEX_HOME: '1',
  OPAL_MIRROR_ASSUME_CODEX_APP_RUNNING: '1',
});
const deferredState = await readGlobalState();
assert(
  deferredExport.status === 0
    && deferredExport.stdout.includes('sidebar registry repair deferred')
    && resetThreadIds.every(id => !deferredState['projectless-thread-ids'].includes(id)),
  'export defers App frontend registry while Codex App is running',
  deferredExport.stdout.trim().split('\n').filter(line => line.includes('app frontend')).join(' | '),
);
const skippedRepair = runRepair([], {
  OPAL_MIRROR_ASSUME_REAL_CODEX_HOME: '1',
  OPAL_MIRROR_ASSUME_CODEX_APP_RUNNING: '1',
});
let skippedRepairResult = {};
try { skippedRepairResult = JSON.parse(skippedRepair.stdout); } catch {}
assert(skippedRepair.status === 0 && skippedRepairResult.status === 'skipped', 'repair refuses live Codex App registry writes', skippedRepair.stdout.trim() || skippedRepair.stderr.trim());
const postQuitRepair = runRepair([], {
  OPAL_MIRROR_ASSUME_REAL_CODEX_HOME: '1',
  OPAL_MIRROR_ASSUME_CODEX_APP_RUNNING: '0',
});
let postQuitRepairResult = {};
try { postQuitRepairResult = JSON.parse(postQuitRepair.stdout); } catch {}
assert(postQuitRepair.status === 0 && postQuitRepairResult.status === 'repaired', 'repair succeeds after simulated Codex App quit', postQuitRepair.stdout.trim() || postQuitRepair.stderr.trim());

if (sqliteAvailable()) {
  const count = spawnSync('sqlite3', [path.join(codexHome, 'state_5.sqlite'), "select count(*) from threads where title like '[webchat:%';"], { encoding: 'utf8' });
  assert(count.status === 0 && count.stdout.trim() === '12', 'sqlite threads registered', count.stdout.trim());
  const row = spawnSync('sqlite3', [path.join(codexHome, 'state_5.sqlite'), "select updated_at_ms, thread_source from threads where title='[webchat:chatgpt] ChatGPT multi turn' and source='cli';"], { encoding: 'utf8' });
  assert(row.stdout.trim() === '1704067380000|user', 'sqlite timestamp/thread_source preserved', row.stdout.trim());
  const appRow = spawnSync('sqlite3', [path.join(codexHome, 'state_5.sqlite'), "select source, cwd, cli_version from threads where title='[webchat:chatgpt] ChatGPT multi turn' and source='vscode';"], { encoding: 'utf8' });
  assert(appRow.stdout.trim() === `vscode|${appCwd}|0.135.0`, 'sqlite App mirror registered', appRow.stdout.trim());
  const chatgptPath = spawnSync('sqlite3', [path.join(codexHome, 'state_5.sqlite'), "select rollout_path from threads where title='[webchat:chatgpt] ChatGPT multi turn' limit 1;"], { encoding: 'utf8' }).stdout.trim();
  const dup = spawnSync('sqlite3', [path.join(codexHome, 'state_5.sqlite')], {
    input: `insert into threads (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title, sandbox_policy, approval_mode, tokens_used, has_user_event, archived, cli_version, first_user_message, memory_mode, model, created_at_ms, updated_at_ms, thread_source, preview) values ('legacy-duplicate-id', '${chatgptPath.replace(/'/g, "''")}', 1704067200, 1704067380, 'cli', 'metana', '${cwd.replace(/'/g, "''")}', '[webchat:chatgpt] ChatGPT multi turn', '{"type":"disabled"}', 'never', 0, 1, 0, '0.135.0', 'first question', 'enabled', 'gpt-5.5', 1704067200000, 1704067380000, 'user', 'first question');\n`,
    encoding: 'utf8',
  });
  assert(dup.status === 0, 'sqlite duplicate fixture inserted');
  const third = runExport();
  assert(third.status === 0 && third.stdout.includes('pruned 1 duplicate'), 'duplicate sqlite webchat row pruned', third.stdout.trim().split('\n').at(-2) || third.stdout.trim());
  const countAfterPrune = spawnSync('sqlite3', [path.join(codexHome, 'state_5.sqlite'), "select count(*) from threads where title like '[webchat:%';"], { encoding: 'utf8' });
  assert(countAfterPrune.stdout.trim() === '12', 'sqlite webchat count stable after prune', countAfterPrune.stdout.trim());
}

await fs.rm(path.join(codexHome, 'sessions'), { recursive: true, force: true });
await fs.rm(path.join(codexHome, 'session_index.jsonl'), { force: true });
await fs.rm(path.join(codexHome, 'history.jsonl'), { force: true });
const defaultCwdExport = runExportDefaultCwd(['--no-state']);
assert(defaultCwdExport.status === 0, 'default cwd export succeeds', defaultCwdExport.stderr.trim());
const defaultFiles = await listRollouts();
const defaultRows = await Promise.all(defaultFiles.map(async file => (await readJsonl(file))[0]));
const expectedDefaultCwd = path.join(codexHome, 'webchat-imports');
const defaultTerminalRows = defaultRows.filter(row => row?.payload?.source === 'cli');
const defaultAppRows = defaultRows.filter(row => row?.payload?.source === 'vscode');
assert(defaultRows.length === 12 && defaultTerminalRows.length === 6 && defaultTerminalRows.every(row => row?.payload?.cwd === expectedDefaultCwd), 'default terminal cwd is webchat-imports', expectedDefaultCwd);
assert(defaultAppRows.length === 6 && defaultAppRows.every(row => row?.payload?.cwd === appCwd), 'default App mirror cwd registered');

console.log('\n=== SUMMARY ===');
const passed = results.filter(r => r.ok).length;
const failed = results.length - passed;
console.log(`${passed} passed / ${failed} failed`);
for (const r of results.filter(r => !r.ok)) console.log(`  FAIL: ${r.name} — ${r.msg}`);

await fs.rm(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
