#!/usr/bin/env node
// Export mirrored web LLM chats as Pixel Distill-compatible custom agent logs.
//
// Pixel Distill already imports local custom agent logs from AGENT_LOG_ROOTS
// by reading OpenClaw/Codex-style JSONL sessions. This exporter adapts the
// archive into that existing contract instead of adding a new Pixel input type.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_ROOT = process.env.AI_CHAT_ARCHIVE_DIR || path.join(__dirname, 'ai-chat-archive');
const DEFAULT_OUT = path.join(ARCHIVE_ROOT, 'pixel-distill-agent');

const args = process.argv.slice(2);
const help = args.includes('--help') || args.includes('-h');
const clean = args.includes('--clean');
const noManifest = args.includes('--no-manifest');
const target = args.find(a => !a.startsWith('-')) || 'all';
const outArg = readFlag('--out') || process.env.PIXEL_DISTILL_AGENT_DIR || DEFAULT_OUT;
const outRoot = path.resolve(outArg);
const sessionsDir = path.join(outRoot, 'sessions');

if (help) {
  console.log(`Export web chat archive into Pixel Distill custom-agent JSONL.

Usage:
  node export_pixel_distill.mjs [all|claude|chatgpt|gemini] [--out DIR] [--clean] [--no-manifest]

Defaults:
  archive: ${ARCHIVE_ROOT}
  output:  ${DEFAULT_OUT}

The output directory is meant to be added to Pixel Distill's AGENT_LOG_ROOTS.
`);
  process.exit(0);
}

function readFlag(name) {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('-')) return args[i + 1];
  const inline = args.find(a => a.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : '';
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

function isoFromAny(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number') {
    const seconds = value > 10_000_000_000 ? value / 1000 : value;
    return new Date(seconds * 1000).toISOString();
  }
  const d = new Date(String(value).replace('Z', '+00:00'));
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toISOString();
}

function epochMs(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function cleanText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function safeId(value) {
  return String(value || 'unknown').replace(/[^A-Za-z0-9_.:-]+/g, '_');
}

function jsonLine(obj) {
  return `${JSON.stringify(obj)}\n`;
}

function sessionLine({ id, platform, title, startedAt, endedAt, model, sourcePath, url }) {
  return {
    type: 'session',
    version: 3,
    id,
    timestamp: startedAt,
    cwd: `/webchat/${platform}`,
    thread_name: title || '(untitled)',
    source: 'webchat',
    platform,
    provider: platform,
    model: model || platform,
    ended_at: endedAt || startedAt,
    raw_ref: sourcePath,
    url: url || '',
    metadata: {
      source: 'webchat',
      platform,
      title: title || '',
      source_path: sourcePath,
      url: url || '',
    },
  };
}

function messageLine({ id, parentId, role, text, ts, platform, model }) {
  return {
    type: 'message',
    id,
    parentId: parentId || null,
    timestamp: ts,
    message: {
      role,
      content: [{ type: 'text', text }],
      provider: 'webchat',
      platform,
      model: model || platform,
      timestamp: epochMs(ts),
    },
  };
}

function normalizeRole(role) {
  const raw = String(role || '').toLowerCase();
  if (raw === 'human' || raw === 'user') return 'user';
  if (raw === 'assistant' || raw === 'model') return 'assistant';
  return '';
}

async function writeSession(platform, sourceFile, session) {
  const turns = session.turns.filter(t => t.role && cleanText(t.text));
  if (!turns.some(t => t.role === 'user')) {
    return { written: false, reason: 'no_user_turn' };
  }

  const firstTs = turns.find(t => t.ts)?.ts || session.startedAt || new Date().toISOString();
  const lastTs = [...turns].reverse().find(t => t.ts)?.ts || session.endedAt || firstTs;
  const id = `webchat:${platform}:${session.id}`;
  const file = path.join(sessionsDir, `${safeId(id)}.jsonl`);
  const lines = [];
  lines.push(jsonLine(sessionLine({
    id,
    platform,
    title: session.title,
    startedAt: firstTs,
    endedAt: lastTs,
    model: session.model,
    sourcePath: sourceFile,
    url: session.url,
  })));

  let parentId = null;
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const msgId = `${safeId(id)}:${i}`;
    lines.push(jsonLine(messageLine({
      id: msgId,
      parentId,
      role: t.role,
      text: cleanText(t.text),
      ts: t.ts || new Date(new Date(firstTs).getTime() + i * 1000).toISOString(),
      platform,
      model: session.model,
    })));
    parentId = msgId;
  }

  await fs.writeFile(file, lines.join(''), 'utf8');
  return { written: true, file, turns: turns.length };
}

async function convertClaude() {
  const dir = path.join(ARCHIVE_ROOT, 'claude');
  const files = await listJSON(dir);
  const out = [];
  for (const name of files) {
    const sourceFile = path.join(dir, name);
    const j = await readJSON(sourceFile);
    const rawTurns = (j.chat_messages || [])
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const turns = rawTurns.map((m, idx) => ({
      role: normalizeRole(m.sender),
      text: m.text || '',
      ts: isoFromAny(m.created_at || m.updated_at, isoFromAny(j.created_at || j.updated_at)) || new Date(Date.now() + idx * 1000).toISOString(),
    }));
    out.push(await writeSession('claude', sourceFile, {
      id: j.uuid || path.basename(name, '.json'),
      title: j.name || '(untitled)',
      model: j.model || 'claude',
      startedAt: isoFromAny(j.created_at || j.updated_at),
      endedAt: isoFromAny(j.updated_at || j.created_at),
      turns,
    }));
  }
  return summarize('claude', files.length, out);
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
  if (Array.isArray(content.parts)) {
    return content.parts.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join('\n').trim();
  }
  if (typeof content.text === 'string') return content.text.trim();
  return '';
}

async function convertChatGPT() {
  const dir = path.join(ARCHIVE_ROOT, 'chatgpt');
  const files = await listJSON(dir);
  const out = [];
  for (const name of files) {
    const sourceFile = path.join(dir, name);
    const j = await readJSON(sourceFile);
    if (!j.mapping) {
      out.push({ written: false, reason: 'missing_mapping' });
      continue;
    }
    const nodes = chatgptPathNodes(j.mapping, j.current_node);
    const turns = [];
    for (let idx = 0; idx < nodes.length; idx++) {
      const msg = nodes[idx]?.message;
      if (!msg) continue;
      const role = normalizeRole(msg.author?.role);
      if (!role) continue;
      if (msg.metadata?.is_visually_hidden_from_conversation) continue;
      const text = chatgptMessageText(msg);
      if (!text) continue;
      turns.push({
        role,
        text,
        ts: isoFromAny(msg.create_time || msg.update_time, isoFromAny(j.create_time || j.update_time)) || new Date(Date.now() + idx * 1000).toISOString(),
      });
    }
    out.push(await writeSession('chatgpt', sourceFile, {
      id: j.conversation_id || path.basename(name, '.json'),
      title: j.title || '(untitled)',
      model: j.default_model_slug || 'chatgpt',
      startedAt: isoFromAny(j.create_time || j.update_time),
      endedAt: isoFromAny(j.update_time || j.create_time),
      turns,
    }));
  }
  return summarize('chatgpt', files.length, out);
}

async function convertGemini() {
  const dir = path.join(ARCHIVE_ROOT, 'gemini');
  const files = await listJSON(dir);
  const out = [];
  for (const name of files) {
    const sourceFile = path.join(dir, name);
    const stat = await fs.stat(sourceFile);
    const j = await readJSON(sourceFile);
    const baseTs = isoFromAny(j.synced_at, stat.mtime.toISOString()) || new Date().toISOString();
    const turns = (j.turns || []).map((t, idx) => ({
      role: normalizeRole(t.role),
      text: t.text || '',
      ts: new Date(new Date(baseTs).getTime() + idx * 1000).toISOString(),
    }));
    out.push(await writeSession('gemini', sourceFile, {
      id: j.id || path.basename(name, '.json'),
      title: j.title || '(untitled)',
      model: 'gemini',
      startedAt: baseTs,
      endedAt: turns.length ? turns[turns.length - 1].ts : baseTs,
      url: j.url,
      turns,
    }));
  }
  return summarize('gemini', files.length, out);
}

function summarize(platform, discovered, rows) {
  const written = rows.filter(r => r.written).length;
  const skipped = rows.length - written;
  const turns = rows.reduce((s, r) => s + (r.turns || 0), 0);
  return { platform, discovered, written, skipped, turns };
}

async function main() {
  const validTargets = new Set(['all', 'claude', 'chatgpt', 'gemini']);
  if (!validTargets.has(target)) {
    console.error(`Unknown target: ${target}`);
    process.exit(2);
  }
  if (clean) {
    await fs.rm(sessionsDir, { recursive: true, force: true });
  }
  await fs.mkdir(sessionsDir, { recursive: true });

  const summaries = [];
  if (target === 'all' || target === 'claude') summaries.push(await convertClaude());
  if (target === 'all' || target === 'chatgpt') summaries.push(await convertChatGPT());
  if (target === 'all' || target === 'gemini') summaries.push(await convertGemini());

  const manifest = {
    generated_at: new Date().toISOString(),
    archive_root: ARCHIVE_ROOT,
    output_root: outRoot,
    target,
    summaries,
    pixel_distill: {
      agent_log_root: outRoot,
      sessions_dir: sessionsDir,
      env: `AGENT_LOG_ROOTS=${outRoot}`,
    },
  };
  if (!noManifest) {
    await fs.writeFile(path.join(outRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  }

  console.log(`wrote Pixel Distill agent sessions to ${sessionsDir}`);
  for (const s of summaries) {
    console.log(`${s.platform}: discovered=${s.discovered}, written=${s.written}, skipped=${s.skipped}, turns=${s.turns}`);
  }
}

await main();
