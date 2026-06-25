#!/usr/bin/env node
// Import mirrored web LLM chats into local Codex /resume history.
//
// This writes real Codex rollout JSONL files and, by default, registers them in
// ~/.codex/state_5.sqlite so the terminal TUI can find them via /resume.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

const help = args.includes('--help') || args.includes('-h');
const target = positionalArgs()[0] || 'all';
const archiveRoot = path.resolve(readFlag('--archive') || process.env.AI_CHAT_ARCHIVE_DIR || path.join(__dirname, 'ai-chat-archive'));
const codexHome = path.resolve(readFlag('--codex-home') || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
const codexCwd = path.resolve(readFlag('--cwd') || process.env.CODEX_IMPORT_CWD || path.join(codexHome, 'webchat-imports'));
const codexAppCwd = path.join(os.homedir(), 'Documents', 'Codex');
const noState = args.includes('--no-state');
const noAppState = args.includes('--no-app-state');
const noLegacyIndex = args.includes('--no-legacy-index');
const resetAppIds = args.includes('--reset-app-ids');
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose');
const importLimit = readPositiveIntFlag('--limit');

if (help) {
  console.log(`Import mirrored web chat archive into Codex /resume.

Usage:
  node export_codex.mjs [all|claude|chatgpt|gemini|deepseek|doubao|qwen] [--archive DIR] [--codex-home DIR] [--cwd DIR] [--limit N] [--no-state] [--no-app-state] [--reset-app-ids] [--no-legacy-index] [--dry-run]

Defaults:
  archive:    ${archiveRoot}
  codex-home: ${codexHome}
  cwd:        ${codexCwd}

By default, imported web chats use <codex-home>/webchat-imports as a stable
virtual cwd so they do not appear as sessions for whatever project directory
Codex is currently filtering by. Pass --cwd only when you intentionally want to
bind imported web chats to a specific local workspace.

What it writes:
  - Codex rollout files under <codex-home>/sessions/YYYY/MM/DD/
  - <codex-home>/state_5.sqlite threads rows, unless --no-state is set
  - App-compatible mirror threads and sidebar registry, unless --no-state or --no-app-state is set.
    If Codex App is currently running against the real ~/.codex home, sidebar
    registry repair is deferred so the app cannot overwrite it on shutdown.
  - legacy session_index.jsonl/history.jsonl rows, unless --no-legacy-index is set

The importer preserves original web-chat timestamps and file mtimes, so /resume
sorts these sessions by when they happened on the web, not by import time.

Use --reset-app-ids to rebuild Codex App mirror thread ids for the selected
target and remove the old App ids from the frontend registry. Terminal Codex ids
remain stable.
`);
  process.exit(0);
}

function readFlag(name) {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('-')) return args[i + 1];
  const inline = args.find(a => a.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : '';
}

function readPositiveIntFlag(name) {
  const raw = readFlag(name);
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`Invalid ${name}: ${raw}. Expected a positive integer.`);
    process.exit(2);
  }
  return n;
}

function positionalArgs() {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      if (!arg.includes('=') && args[i + 1] && !args[i + 1].startsWith('-')) i++;
      continue;
    }
    if (arg.startsWith('-')) continue;
    out.push(arg);
  }
  return out;
}

function cleanText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function isoFromAny(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number') {
    const seconds = value > 10_000_000_000 ? value / 1000 : value;
    return new Date(seconds * 1000).toISOString();
  }
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    const n = Number(value.trim());
    const seconds = n > 10_000_000_000 ? n / 1000 : n;
    return new Date(seconds * 1000).toISOString();
  }
  const d = new Date(String(value).replace('Z', '+00:00'));
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toISOString();
}

function epochSeconds(iso) {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Math.floor(Date.now() / 1000) : Math.floor(ms / 1000);
}

function safeId(value) {
  return String(value || 'unknown').replace(/[^A-Za-z0-9_.:-]+/g, '_');
}

function uuidV5(name, namespace = '6ba7b811-9dad-11d1-80b4-00c04fd430c8') {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = crypto.createHash('sha1').update(ns).update(String(name)).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function uuidV7Like(ms = Date.now(), entropy = crypto.randomBytes(10).toString('hex')) {
  const timestampHex = BigInt(ms).toString(16).padStart(12, '0').slice(-12);
  const hash = crypto.createHash('sha1').update(String(entropy)).digest('hex');
  return `${timestampHex.slice(0, 8)}-${timestampHex.slice(8, 12)}-7000-8000-${hash.slice(0, 12)}`;
}

function appThreadMapPath() {
  return path.join(archiveRoot, '_codex_app_thread_ids.json');
}

async function loadAppThreadMap() {
  try {
    return JSON.parse(await fs.readFile(appThreadMapPath(), 'utf8'));
  } catch {
    return {};
  }
}

function pruneResetAppThreadMap(map, sessions) {
  if (!resetAppIds) return {};
  const previous = {};
  for (const session of sessions) {
    const webchatId = `webchat:${session.platform}:${session.id}`;
    if (map[webchatId]) previous[webchatId] = map[webchatId];
    delete map[webchatId];
  }
  return previous;
}

async function saveAppThreadMap(map) {
  if (dryRun || noAppState) return;
  const file = appThreadMapPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
}

function appThreadIdFor(webchatId, map, firstIso) {
  if (map[webchatId]) return map[webchatId];
  const ms = Date.parse(firstIso);
  const id = uuidV7Like(Number.isNaN(ms) ? Date.now() : ms);
  map[webchatId] = id;
  return id;
}

function appOutputDirFor(threadId) {
  return path.join(codexAppCwd, 'webchat-imports', threadId, 'outputs');
}

function isRealCodexHome() {
  if (process.env.OPAL_MIRROR_ASSUME_REAL_CODEX_HOME === '1') return true;
  if (process.env.OPAL_MIRROR_ASSUME_REAL_CODEX_HOME === '0') return false;
  return path.resolve(codexHome) === path.resolve(path.join(os.homedir(), '.codex'));
}

function codexAppIsRunning() {
  if (process.env.OPAL_MIRROR_ASSUME_CODEX_APP_RUNNING === '1') return true;
  if (process.env.OPAL_MIRROR_ASSUME_CODEX_APP_RUNNING === '0') return false;
  const ps = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  if (ps.status !== 0) return false;
  return ps.stdout.split('\n').some(line => (
    line.includes('/Applications/Codex.app/Contents/MacOS/Codex')
    || line.includes('/Applications/Codex.app/Contents/Resources/codex app-server')
  ));
}

function shouldDeferAppFrontendWrite() {
  if (process.env.OPAL_MIRROR_ALLOW_RUNNING_CODEX_APP === '1') return false;
  if (args.includes('--allow-running-app-state')) return false;
  return isRealCodexHome() && codexAppIsRunning();
}

function rolloutPathFor(sessionId, firstIso) {
  const d = new Date(firstIso);
  const year = String(d.getUTCFullYear());
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const stamp = firstIso.replace(/\.\d{3}Z$/, '').replace(/:/g, '-').replace('Z', '');
  return path.join(codexHome, 'sessions', year, month, day, `rollout-${stamp}-${sessionId}.jsonl`);
}

function jsonLine(obj) {
  return `${JSON.stringify(obj)}\n`;
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        if (typeof item.text === 'string') return item.text;
        if (typeof item.content === 'string') return item.content;
        return JSON.stringify(item);
      }
      return '';
    }).filter(Boolean).join('\n');
  }
  if (content && typeof content.text === 'string') return content.text;
  return '';
}

function normalizeRole(role) {
  const raw = String(role || '').toLowerCase();
  if (raw === 'human' || raw === 'user' || raw === 'customer') return 'user';
  if (raw === 'assistant' || raw === 'model' || raw === 'bot') return 'assistant';
  return '';
}

async function listJSON(dir) {
  try {
    const files = await fs.readdir(dir);
    return files.filter(f => f.endsWith('.json') && !f.startsWith('_')).sort();
  } catch {
    return [];
  }
}

async function readJSON(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function chatgptPathNodes(mapping, currentNode) {
  if (!mapping || typeof mapping !== 'object') return [];
  if (currentNode && mapping[currentNode]) {
    const chain = [];
    const seen = new Set();
    let id = currentNode;
    while (id && mapping[id] && !seen.has(id)) {
      seen.add(id);
      chain.push(mapping[id]);
      id = mapping[id].parent;
    }
    return chain.reverse();
  }
  return Object.values(mapping).sort((a, b) => {
    const am = a.message || {};
    const bm = b.message || {};
    return (am.create_time || 0) - (bm.create_time || 0);
  });
}

function chatgptMessageText(msg) {
  const content = msg?.content || {};
  return cleanText(contentText(content.parts || content.text || ''));
}

function pushTurn(turns, role, text, ts) {
  const cleaned = cleanText(text);
  if (!role || !cleaned) return;
  turns.push({ role, text: cleaned, ts });
}

function plusSeconds(iso, seconds) {
  const ms = Date.parse(iso);
  return new Date((Number.isNaN(ms) ? Date.now() : ms) + seconds * 1000).toISOString();
}

function stableUnknownTimestamp(platform, id) {
  const hash = crypto.createHash('sha1').update(`${platform}:${id}`).digest();
  const offset = hash.readUInt32BE(0) % (365 * 24 * 60 * 60);
  return new Date(Date.UTC(2000, 0, 1) + offset * 1000).toISOString();
}

async function loadClaude() {
  const dir = path.join(archiveRoot, 'claude');
  const files = await listJSON(dir);
  const sessions = [];
  for (const name of files) {
    const sourceFile = path.join(dir, name);
    const j = await readJSON(sourceFile);
    const baseTs = isoFromAny(j.created_at || j.updated_at) || new Date().toISOString();
    const turns = (j.chat_messages || [])
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((m, idx) => ({
        role: normalizeRole(m.sender),
        text: m.text || '',
        ts: isoFromAny(m.created_at || m.updated_at, new Date(Date.parse(baseTs) + idx * 1000).toISOString()),
      }));
    sessions.push({
      platform: 'claude',
      id: j.uuid || path.basename(name, '.json'),
      title: j.name || '(untitled)',
      model: j.model || 'claude',
      startedAt: isoFromAny(j.created_at || j.updated_at, baseTs),
      endedAt: isoFromAny(j.updated_at || j.created_at, baseTs),
      sourceFile,
      turns,
    });
  }
  return sessions;
}

async function loadChatGPT() {
  const dir = path.join(archiveRoot, 'chatgpt');
  const files = await listJSON(dir);
  const sessions = [];
  for (const name of files) {
    const sourceFile = path.join(dir, name);
    const j = await readJSON(sourceFile);
    if (!j.mapping) continue;
    const nodes = chatgptPathNodes(j.mapping, j.current_node);
    const sourceStartTs = isoFromAny(j.create_time || j.update_time, null);
    const sourceEndTs = isoFromAny(j.update_time || j.create_time, null);
    const baseTs = sourceStartTs || stableUnknownTimestamp('chatgpt', j.conversation_id || path.basename(name, '.json'));
    const turns = [];
    for (let idx = 0; idx < nodes.length; idx++) {
      const msg = nodes[idx]?.message;
      if (!msg) continue;
      if (msg.metadata?.is_visually_hidden_from_conversation) continue;
      const rawRole = String(msg.author?.role || '').toLowerCase();
      const role = rawRole === 'tool' ? 'assistant' : normalizeRole(rawRole);
      const text = chatgptMessageText(msg);
      const ts = isoFromAny(msg.create_time || msg.update_time, new Date(Date.parse(baseTs) + idx * 1000).toISOString());
      pushTurn(turns, role, text, ts);
    }
    sessions.push({
      platform: 'chatgpt',
      id: j.conversation_id || path.basename(name, '.json'),
      title: j.title || '(untitled)',
      model: j.default_model_slug || 'chatgpt',
      timestampConfidence: sourceStartTs || sourceEndTs ? 'chatgpt:conversation' : 'ordered_fallback',
      startedAt: sourceStartTs || baseTs,
      endedAt: sourceEndTs || (turns.length ? turns[turns.length - 1].ts : baseTs),
      sourceFile,
      turns,
    });
  }
  return sessions;
}

async function loadGemini() {
  const dir = path.join(archiveRoot, 'gemini');
  const files = await listJSON(dir);
  const sessions = [];
  for (const name of files) {
    const sourceFile = path.join(dir, name);
    const j = await readJSON(sourceFile);
    const sourceTs = isoFromAny(j.created_at || j.updated_at || j.last_message_at || j.timestamp, null);
    const fallbackTs = stableUnknownTimestamp('gemini', j.id || path.basename(name, '.json'));
    const baseTs = sourceTs || fallbackTs;
    const turns = (j.turns || []).map((t, idx) => ({
      role: normalizeRole(t.role),
      text: t.text || '',
      ts: isoFromAny(t.created_at || t.updated_at || t.timestamp, new Date(Date.parse(baseTs) + idx * 1000).toISOString()),
    }));
    sessions.push({
      platform: 'gemini',
      id: j.id || path.basename(name, '.json'),
      title: j.title || '(untitled)',
      model: 'gemini',
      timestampConfidence: sourceTs ? (j.timestamp_source || 'source') : 'ordered_fallback',
      startedAt: baseTs,
      endedAt: turns.length ? turns[turns.length - 1].ts : baseTs,
      sourceFile,
      url: j.url,
      turns,
    });
  }
  return sessions;
}

function deepseekMessageText(m) {
  return cleanText(m.content || (m.fragments || []).map(fr => fr.content || fr.text || '').join('\n'));
}

async function loadDeepSeek() {
  const dir = path.join(archiveRoot, 'deepseek');
  const files = await listJSON(dir);
  const sessions = [];
  for (const name of files) {
    const sourceFile = path.join(dir, name);
    const j = await readJSON(sourceFile);
    const baseTs = isoFromAny(j.inserted_at || j.created_at || j.updated_at) || new Date().toISOString();
    const messages = (j.chat_messages || []).slice().sort((a, b) => {
      const ai = Number(a.index ?? a.message_index ?? a.seq ?? a.seq_id ?? 0);
      const bi = Number(b.index ?? b.message_index ?? b.seq ?? b.seq_id ?? 0);
      return ai - bi;
    });
    const turns = [];
    for (let idx = 0; idx < messages.length; idx++) {
      const m = messages[idx];
      const ts = isoFromAny(m.inserted_at || m.created_at || m.updated_at, plusSeconds(baseTs, idx));
      pushTurn(turns, normalizeRole(m.role), deepseekMessageText(m), ts);
    }
    sessions.push({
      platform: 'deepseek',
      id: j.id || j.chat_session?.id || path.basename(name, '.json'),
      title: j.title || '(untitled)',
      model: j.model_type || j.chat_session?.model_type || 'deepseek',
      startedAt: isoFromAny(j.inserted_at || j.created_at || j.updated_at, baseTs),
      endedAt: isoFromAny(j.updated_at || j.created_at || j.inserted_at, turns.at(-1)?.ts || baseTs),
      sourceFile,
      turns,
    });
  }
  return sessions;
}

function doubaoMessageText(m) {
  const texts = [];
  for (const block of (m.content_block || [])) {
    const content = block?.content || {};
    if (content.text_block?.text) texts.push(content.text_block.text);
    else if (typeof content.text === 'string') texts.push(content.text);
    else if (typeof block.text === 'string') texts.push(block.text);
  }
  return cleanText(texts.join('\n'));
}

function doubaoRole(m) {
  if (Number(m.user_type) === 1) return 'user';
  if (Number(m.user_type) === 2) return 'assistant';
  return normalizeRole(m.role || m.sender || m.author?.role);
}

async function loadDoubao() {
  const dir = path.join(archiveRoot, 'doubao');
  const files = await listJSON(dir);
  const sessions = [];
  for (const name of files) {
    const sourceFile = path.join(dir, name);
    const j = await readJSON(sourceFile);
    const baseTs = isoFromAny(j.create_time || j.update_time) || new Date().toISOString();
    const messages = (j.messages || []).slice().sort((a, b) => Number(a.index_in_conv || 0) - Number(b.index_in_conv || 0));
    const turns = [];
    for (let idx = 0; idx < messages.length; idx++) {
      const m = messages[idx];
      const ts = isoFromAny(m.create_time || m.created_at || m.update_time || m.updated_at, plusSeconds(baseTs, idx));
      pushTurn(turns, doubaoRole(m), doubaoMessageText(m), ts);
    }
    sessions.push({
      platform: 'doubao',
      id: j.conversation_id || j.thread_id || path.basename(name, '.json'),
      title: j.name || '(untitled)',
      model: j.bot_id || 'doubao',
      startedAt: isoFromAny(j.create_time || j.update_time, baseTs),
      endedAt: isoFromAny(j.update_time || j.create_time, turns.at(-1)?.ts || baseTs),
      sourceFile,
      turns,
    });
  }
  return sessions;
}

function qwenMessagesText(messages) {
  const arr = Array.isArray(messages) ? messages : messages ? [messages] : [];
  return cleanText(arr.map(m => {
    if (typeof m === 'string') return m;
    if (typeof m?.content === 'string') return m.content;
    if (Array.isArray(m?.content)) return contentText(m.content);
    if (typeof m?.text === 'string') return m.text;
    return '';
  }).filter(Boolean).join('\n'));
}

async function loadQwen() {
  const dir = path.join(archiveRoot, 'qwen');
  const files = await listJSON(dir);
  const sessions = [];
  for (const name of files) {
    const sourceFile = path.join(dir, name);
    const j = await readJSON(sourceFile);
    const baseTs = isoFromAny(j.created_at || j.updated_at) || new Date().toISOString();
    const records = (j.records || []).slice().sort((a, b) => {
      const ai = Number(a.index ?? a.msg_index ?? a.created_at ?? 0);
      const bi = Number(b.index ?? b.msg_index ?? b.created_at ?? 0);
      return ai - bi;
    });
    const turns = [];
    for (let idx = 0; idx < records.length; idx++) {
      const r = records[idx];
      const ts = isoFromAny(r.created_at || r.updated_at || r.time, plusSeconds(baseTs, idx * 2));
      pushTurn(turns, 'user', qwenMessagesText(r.request_messages), ts);
      pushTurn(turns, 'assistant', qwenMessagesText(r.response_messages || r.responses || r.response), plusSeconds(ts, 1));
    }
    sessions.push({
      platform: 'qwen',
      id: j.session_id || path.basename(name, '.json'),
      title: j.title || '(untitled)',
      model: 'qwen',
      startedAt: isoFromAny(j.created_at || j.updated_at, baseTs),
      endedAt: isoFromAny(j.updated_at || j.created_at, turns.at(-1)?.ts || baseTs),
      sourceFile,
      turns,
    });
  }
  return sessions;
}

function displayTitle(session) {
  return `[webchat:${session.platform}] ${session.title || '(untitled)'}`;
}

function responseItem(role, text, timestamp) {
  return {
    timestamp,
    type: 'response_item',
    payload: {
      type: 'message',
      role,
      content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }],
    },
  };
}

function groupTurns(turns) {
  const cleaned = turns
    .map(t => ({ role: t.role, text: cleanText(t.text), ts: t.ts }))
    .filter(t => t.role && t.text);
  const groups = [];
  for (const t of cleaned) {
    if (t.role === 'user' || groups.length === 0) {
      groups.push({ user: t.role === 'user' ? t : null, assistants: t.role === 'assistant' ? [t] : [] });
    } else {
      groups[groups.length - 1].assistants.push(t);
    }
  }
  return groups.filter(g => g.user);
}

async function writeCodexSession(session, appThreadMap) {
  const groups = groupTurns(session.turns);
  if (!groups.length) return { written: false, reason: 'no_user_turn' };
  const firstIso = groups[0].user.ts || session.startedAt || new Date().toISOString();
  const lastGroup = groups[groups.length - 1];
  const lastAssistant = lastGroup.assistants[lastGroup.assistants.length - 1];
  const lastIso = lastAssistant?.ts || lastGroup.user.ts || session.endedAt || firstIso;
  const id = uuidV5(`webchat:${session.platform}:${session.id}`);
  const webchatId = `webchat:${session.platform}:${session.id}`;
  const title = displayTitle(session);
  const appId = appThreadIdFor(webchatId, appThreadMap, firstIso);
  const file = rolloutPathFor(id, firstIso);
  const appFile = rolloutPathFor(appId, firstIso);
  const lines = [];

  if (!dryRun) {
    await removeOldRolloutsForWebchat(webchatId, new Set([file, appFile]));
  }

  const buildLines = ({ threadId, cwd, originator, source, cliVersion, mirrorTarget }) => {
    const out = [];
    out.push(jsonLine({
    timestamp: firstIso,
    type: 'session_meta',
    payload: {
      id: threadId,
      timestamp: firstIso,
      cwd,
      originator,
      cli_version: cliVersion,
      source,
      thread_source: 'user',
      model_provider: 'metana',
      model: 'gpt-5.5',
      thread_name: title,
      metadata: {
        webchat_id: webchatId,
        raw_ref: session.sourceFile,
        platform: session.platform,
        imported_by: 'opal-mirror',
        mirror_target: mirrorTarget,
        timestamp_confidence: session.timestampConfidence || 'source',
        url: session.url || '',
      },
    },
    }));

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const turnId = i === 0 ? threadId : uuidV5(`${threadId}:${i + 1}`);
      const userTs = group.user.ts || new Date(Date.parse(firstIso) + i * 1000).toISOString();
      const startedAt = epochSeconds(userTs);
      out.push(jsonLine({
        timestamp: userTs,
        type: 'event_msg',
        payload: {
          type: 'task_started',
          turn_id: turnId,
          started_at: startedAt,
          model_context_window: 258400,
          collaboration_mode_kind: 'default',
        },
      }));
      out.push(jsonLine({
        timestamp: userTs,
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: group.user.text,
          images: [],
          local_images: [],
          text_elements: [],
          turn_id: turnId,
        },
      }));
      out.push(jsonLine({
        timestamp: userTs,
        type: 'turn_context',
        payload: {
          turn_id: turnId,
          cwd,
          current_date: userTs.slice(0, 10),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          approval_policy: 'never',
          sandbox_policy: { type: 'danger-full-access' },
          permission_profile: { type: 'disabled' },
          model: 'gpt-5.5',
        },
      }));
      out.push(jsonLine(responseItem('user', group.user.text, userTs)));

      let completeTs = userTs;
      let lastAgentMessage = 'Imported web chat session';
      for (const a of group.assistants) {
        const assistantTs = a.ts || completeTs;
        completeTs = assistantTs;
        lastAgentMessage = a.text;
        out.push(jsonLine({
          timestamp: assistantTs,
          type: 'event_msg',
          payload: {
            type: 'agent_message',
            message: a.text,
            phase: 'final_answer',
            memory_citation: null,
          },
        }));
        out.push(jsonLine(responseItem('assistant', a.text, assistantTs)));
      }
      out.push(jsonLine({
        timestamp: completeTs,
        type: 'event_msg',
        payload: {
          type: 'task_complete',
          turn_id: turnId,
          last_agent_message: lastAgentMessage.slice(0, 4000),
          completed_at: epochSeconds(completeTs),
        },
      }));
    }
    return out;
  };

  lines.push(...buildLines({
    threadId: id,
    cwd: codexCwd,
    originator: 'codex-tui',
    source: 'cli',
    cliVersion: '0.135.0',
    mirrorTarget: 'terminal',
  }));
  const appLines = buildLines({
    threadId: appId,
    cwd: codexAppCwd,
    originator: 'Codex Desktop',
    source: 'vscode',
    cliVersion: '0.135.0',
    mirrorTarget: 'codex_app',
  });

  if (!dryRun) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, lines.join(''), 'utf8');
    if (!noAppState) {
      await fs.mkdir(path.dirname(appFile), { recursive: true });
      await fs.writeFile(appFile, appLines.join(''), 'utf8');
    }
    const ts = epochSeconds(lastIso);
    await fs.utimes(file, ts, ts);
    if (!noAppState) await fs.utimes(appFile, ts, ts);
  }

  return {
    written: true,
    id,
    appId,
    webchatId,
    title,
    file,
    appFile,
    firstIso,
    lastIso,
    groups: groups.length,
    assistantMessages: groups.reduce((sum, g) => sum + g.assistants.length, 0),
    firstUserMessage: groups[0].user.text,
    model: session.model || session.platform,
    variants: noAppState ? ['terminal'] : ['terminal', 'app'],
  };
}

async function removeOldRolloutsForWebchat(webchatId, keepFiles) {
  const root = path.join(codexHome, 'sessions');
  const files = [];
  async function walk(dir) {
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) files.push(p);
    }
  }
  await walk(root);
  for (const f of files) {
    if ([...keepFiles].some(keep => path.resolve(f) === path.resolve(keep))) continue;
    const existingId = await webchatIdFromRollout(f);
    if (existingId === webchatId) await fs.rm(f, { force: true });
  }
}

function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function registerState(rows, staleAppIdsByWebchat = {}) {
  if (noState || dryRun || !rows.length) return { skipped: true, reason: noState ? '--no-state' : dryRun ? '--dry-run' : 'no_rows' };
  const db = path.join(codexHome, 'state_5.sqlite');
  if (!fsSync.existsSync(db)) return { skipped: true, reason: `missing ${db}` };
  const sqlite = spawnSync('sqlite3', ['--version'], { encoding: 'utf8' });
  if (sqlite.status !== 0) return { skipped: true, reason: 'sqlite3 command not available' };

  const backup = path.join(codexHome, `state_5.sqlite.backup-before-opal-mirror-import-${timestampForFile(new Date())}`);
  const backupResult = spawnSync('sqlite3', [db], {
    input: `.backup ${sqlValue(backup)}\n`,
    encoding: 'utf8',
  });
  if (backupResult.status !== 0) {
    throw new Error(`sqlite3 backup failed: ${backupResult.stderr || backupResult.stdout}`);
  }

  const stateRows = rows.flatMap(stateRowsForImport);
  const duplicateIds = [
    ...new Set([
      ...await findDuplicateThreadIds(db, stateRows),
      ...Object.values(staleAppIdsByWebchat).filter(Boolean),
    ]),
  ];
  const statements = ['BEGIN;'];
  for (const id of duplicateIds) {
    statements.push(`DELETE FROM threads WHERE id=${sqlValue(id)};`);
  }
  for (const r of stateRows) {
    const created = epochSeconds(r.firstIso);
    const updated = epochSeconds(r.lastIso);
    const first = r.firstUserMessage.slice(0, 4000);
    const preview = first || r.title;
    const values = [
      r.id,
      r.file,
      created,
      updated,
      r.source,
      'metana',
      r.cwd,
      r.title,
      JSON.stringify({ type: 'disabled' }),
      'never',
      0,
      1,
      0,
      null,
      null,
      null,
      null,
      r.cliVersion,
      first,
      null,
      null,
      'enabled',
      'gpt-5.5',
      null,
      null,
      created * 1000,
      updated * 1000,
      'user',
      preview,
    ].map(sqlValue).join(', ');
    statements.push(`
INSERT INTO threads (
  id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
  sandbox_policy, approval_mode, tokens_used, has_user_event, archived, archived_at,
  git_sha, git_branch, git_origin_url, cli_version, first_user_message,
  agent_nickname, agent_role, memory_mode, model, reasoning_effort, agent_path,
  created_at_ms, updated_at_ms, thread_source, preview
) VALUES (${values})
ON CONFLICT(id) DO UPDATE SET
  rollout_path=excluded.rollout_path,
  created_at=excluded.created_at,
  updated_at=excluded.updated_at,
  source=excluded.source,
  model_provider=excluded.model_provider,
  cwd=excluded.cwd,
  title=excluded.title,
  sandbox_policy=excluded.sandbox_policy,
  approval_mode=excluded.approval_mode,
  tokens_used=excluded.tokens_used,
  has_user_event=excluded.has_user_event,
  archived=excluded.archived,
  archived_at=excluded.archived_at,
  cli_version=excluded.cli_version,
  first_user_message=excluded.first_user_message,
  memory_mode=excluded.memory_mode,
  model=excluded.model,
  created_at_ms=excluded.created_at_ms,
  updated_at_ms=excluded.updated_at_ms,
  thread_source=excluded.thread_source,
  preview=excluded.preview;`);
  }
  statements.push('COMMIT;');
  const sqlFile = path.join(os.tmpdir(), `opal-mirror-codex-import-${process.pid}.sql`);
  await fs.writeFile(sqlFile, statements.join('\n'), 'utf8');
  const result = spawnSync('sqlite3', [db], { input: `.read ${sqlFile}\n`, encoding: 'utf8' });
  await fs.rm(sqlFile, { force: true });
  if (result.status !== 0) {
    throw new Error(`sqlite3 import failed: ${result.stderr || result.stdout}`);
  }
  return { skipped: false, backup, pruned: duplicateIds.length };
}

function stateRowsForImport(r) {
  const rows = [{
    ...r,
    source: 'cli',
    cwd: codexCwd,
    cliVersion: '0.135.0',
  }];
  if (!noAppState && r.appId && r.appFile) {
    rows.push({
      ...r,
      id: r.appId,
      file: r.appFile,
      source: 'vscode',
      cwd: codexAppCwd,
      cliVersion: '0.135.0',
    });
  }
  return rows;
}

async function registerAppFrontendState(rows, staleAppIdsByWebchat = {}) {
  if (noState || noAppState || dryRun || !rows.length) {
    return { skipped: true, reason: noState ? '--no-state' : noAppState ? '--no-app-state' : dryRun ? '--dry-run' : 'no_rows' };
  }
  if (shouldDeferAppFrontendWrite()) {
    return {
      skipped: true,
      deferred: true,
      reason: 'Codex App is running; sidebar registry repair deferred until the app fully quits',
    };
  }

  const appRows = rows
    .filter(r => r.appId)
    .map(r => ({ ...r, id: r.appId, cwd: codexAppCwd, outputDir: appOutputDirFor(r.appId) }));
  if (!appRows.length) return { skipped: true, reason: 'no_app_rows' };

  const file = path.join(codexHome, '.codex-global-state.json');
  let state = {};
  try {
    state = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const backup = fsSync.existsSync(file)
    ? path.join(codexHome, `.codex-global-state.json.backup-before-opal-mirror-import-${timestampForFile(new Date())}`)
    : null;
  if (backup) await fs.copyFile(file, backup);

  const projectless = Array.isArray(state['projectless-thread-ids']) ? state['projectless-thread-ids'] : [];
  const imported = new Set(appRows.map(r => r.id));
  const stale = new Set(Object.values(staleAppIdsByWebchat).filter(Boolean));
  const existingWithoutImports = projectless.filter(id => !imported.has(id) && !stale.has(id));
  state['projectless-thread-ids'] = [...existingWithoutImports, ...appRows.map(r => r.id)];

  const hints = state['thread-workspace-root-hints'] && typeof state['thread-workspace-root-hints'] === 'object'
    ? state['thread-workspace-root-hints']
    : {};
  const outputDirs = state['thread-projectless-output-directories'] && typeof state['thread-projectless-output-directories'] === 'object'
    ? state['thread-projectless-output-directories']
    : {};
  state['thread-workspace-root-hints'] = hints;
  state['thread-projectless-output-directories'] = outputDirs;

  const atomState = state['electron-persisted-atom-state'] && typeof state['electron-persisted-atom-state'] === 'object'
    ? state['electron-persisted-atom-state']
    : {};
  state['electron-persisted-atom-state'] = atomState;
  const permissions = atomState['heartbeat-thread-permissions-by-id'] && typeof atomState['heartbeat-thread-permissions-by-id'] === 'object'
    ? atomState['heartbeat-thread-permissions-by-id']
    : {};
  atomState['heartbeat-thread-permissions-by-id'] = permissions;

  for (const id of stale) {
    delete hints[id];
    delete outputDirs[id];
    delete permissions[id];
  }

  for (const r of appRows) {
    hints[r.id] = r.cwd;
    outputDirs[r.id] = r.outputDir;
    permissions[r.id] = {
      activePermissionProfile: { id: ':danger-full-access', extends: null },
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxPolicy: { type: 'dangerFullAccess' },
    };
    await fs.mkdir(r.outputDir, { recursive: true });
  }

  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(state)}\n`, 'utf8');
  return { skipped: false, file, backup, registered: appRows.length };
}

async function findDuplicateThreadIds(db, rows) {
  const wanted = new Map();
  for (const r of rows) {
    if (!wanted.has(r.webchatId)) wanted.set(r.webchatId, new Set());
    wanted.get(r.webchatId).add(r.id);
  }
  if (!wanted.size) return [];
  const query = "select id, rollout_path from threads where title like '[webchat:%'";
  const result = spawnSync('sqlite3', [db, '-json', query], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout.trim()) return [];
  let existing = [];
  try { existing = JSON.parse(result.stdout); } catch { return []; }
  const duplicates = [];
  for (const row of existing) {
    const webchatId = await webchatIdFromRollout(row.rollout_path);
    const canonicalIds = wanted.get(webchatId);
    if (canonicalIds && !canonicalIds.has(row.id)) duplicates.push(row.id);
  }
  return duplicates;
}

async function webchatIdFromRollout(file) {
  try {
    const fh = await fs.open(file, 'r');
    try {
      const { buffer, bytesRead } = await fh.read(Buffer.alloc(8192), 0, 8192, 0);
      const firstLine = buffer.subarray(0, bytesRead).toString('utf8').split('\n')[0];
      const row = JSON.parse(firstLine);
      return row?.payload?.metadata?.webchat_id || '';
    } finally {
      await fh.close();
    }
  } catch {
    return '';
  }
}

function timestampForFile(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
}

async function appendLegacyIndexes(rows) {
  if (noLegacyIndex || dryRun || !rows.length) return { skipped: true };
  await fs.mkdir(codexHome, { recursive: true });
  const sessionIndex = path.join(codexHome, 'session_index.jsonl');
  const history = path.join(codexHome, 'history.jsonl');
  const ids = new Set(rows.map(r => r.id));
  const webchatIds = new Set(rows.map(r => r.webchatId));
  const indexLines = [];
  const historyLines = [];
  for (const r of rows) {
    indexLines.push(jsonLine({
      id: r.id,
      webchat_id: r.webchatId,
      path: r.file,
      title: r.title,
      timestamp: r.firstIso,
      updated_at: r.lastIso,
      source: 'cli',
      thread_source: 'user',
      model_provider: 'metana',
      cwd: codexCwd,
      imported_by: 'opal-mirror',
    }));
    historyLines.push(jsonLine({
      session_id: r.id,
      webchat_id: r.webchatId,
      ts: r.lastIso,
      text: r.title,
      cwd: codexCwd,
    }));
  }
  await replaceJsonlRows(sessionIndex, row => !ids.has(row?.id) && !webchatIds.has(row?.webchat_id), indexLines);
  await replaceJsonlRows(history, row => !ids.has(row?.session_id) && !webchatIds.has(row?.webchat_id), historyLines);
  return { skipped: false };
}

async function replaceJsonlRows(file, keep, newLines) {
  let lines = [];
  try {
    const existing = await fs.readFile(file, 'utf8');
    lines = existing.split('\n').filter(Boolean).filter(line => {
      try { return keep(JSON.parse(line)); }
      catch { return true; }
    });
  } catch {}
  lines.push(...newLines.map(line => line.trimEnd()).filter(Boolean));
  await fs.writeFile(file, lines.join('\n') + '\n', 'utf8');
}

async function loadSessions() {
  const validTargets = new Set(['all', 'claude', 'chatgpt', 'gemini', 'deepseek', 'doubao', 'qwen']);
  if (!validTargets.has(target)) {
    console.error(`Unknown target: ${target}`);
    process.exit(2);
  }
  const sessions = [];
  if (target === 'all' || target === 'claude') sessions.push(...await loadClaude());
  if (target === 'all' || target === 'chatgpt') sessions.push(...await loadChatGPT());
  if (target === 'all' || target === 'gemini') sessions.push(...await loadGemini());
  if (target === 'all' || target === 'deepseek') sessions.push(...await loadDeepSeek());
  if (target === 'all' || target === 'doubao') sessions.push(...await loadDoubao());
  if (target === 'all' || target === 'qwen') sessions.push(...await loadQwen());
  sessions.sort((a, b) => String(b.endedAt || '').localeCompare(String(a.endedAt || '')));
  return importLimit ? sessions.slice(0, importLimit) : sessions;
}

async function main() {
  const sessions = await loadSessions();
  if (!dryRun) await fs.mkdir(codexHome, { recursive: true });
  const appThreadMap = await loadAppThreadMap();
  const staleAppIdsByWebchat = pruneResetAppThreadMap(appThreadMap, sessions);
  const rows = [];
  const summary = {};
  for (const s of sessions) {
    summary[s.platform] ||= { discovered: 0, written: 0, skipped: 0, turns: 0, assistantMessages: 0 };
    summary[s.platform].discovered++;
    const row = await writeCodexSession(s, appThreadMap);
    if (!row.written) {
      summary[s.platform].skipped++;
      if (verbose) console.log(`skip ${s.platform}:${s.id} ${row.reason}`);
      continue;
    }
    rows.push(row);
    summary[s.platform].written++;
    summary[s.platform].turns += row.groups;
    summary[s.platform].assistantMessages += row.assistantMessages;
  }

  await saveAppThreadMap(appThreadMap);
  const state = await registerState(rows, staleAppIdsByWebchat);
  const appFrontend = await registerAppFrontendState(rows, staleAppIdsByWebchat);
  const legacy = await appendLegacyIndexes(rows);
  console.log(`${dryRun ? 'would write' : 'wrote'} Codex sessions under ${path.join(codexHome, 'sessions')}`);
  for (const [platform, s] of Object.entries(summary)) {
    console.log(`${platform}: discovered=${s.discovered}, written=${s.written}, skipped=${s.skipped}, turns=${s.turns}, assistant_messages=${s.assistantMessages}`);
  }
  console.log(`state: ${state.skipped ? `skipped (${state.reason})` : `updated (backup ${state.backup})`}`);
  console.log(`app frontend: ${appFrontend.skipped ? `skipped (${appFrontend.reason})` : `registered ${appFrontend.registered} thread(s) (backup ${appFrontend.backup || 'none'})`}`);
  if (appFrontend.deferred) {
    console.log(`app frontend: run node ${path.join(__dirname, 'repair_codex_app_frontend.mjs')} --archive ${archiveRoot} --codex-home ${codexHome} after fully quitting Codex App`);
  }
  if (Object.keys(staleAppIdsByWebchat).length) console.log(`app frontend: reset ${Object.keys(staleAppIdsByWebchat).length} stale App mirror id(s)`);
  if (!state.skipped && state.pruned) console.log(`state: pruned ${state.pruned} duplicate imported thread row(s)`);
  console.log(`legacy index: ${legacy.skipped ? 'skipped' : 'updated'}`);
}

await main();
