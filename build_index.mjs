#!/usr/bin/env node
// Build INDEX.md — a human-browsable table of all archived conversations.
//
// Reads JSON files from {AI_CHAT_ARCHIVE_DIR}/{claude,chatgpt,gemini}/
// and writes INDEX.md alongside them.

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const ROOT = process.env.AI_CHAT_ARCHIVE_DIR || path.join(os.homedir(), 'ai-chat-archive');

async function listJSON(dir) {
  try {
    const files = await fs.readdir(dir);
    return files.filter(f => f.endsWith('.json') && !f.startsWith('_'));
  } catch { return []; }
}

const lines = [
  '# AI Chat Archive — Index',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
];

// Claude
{
  const dir = path.join(ROOT, 'claude');
  const files = await listJSON(dir);
  const items = [];
  for (const f of files) {
    const j = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
    const chars = (j.chat_messages || []).reduce((s, m) => s + (m.text || '').length, 0);
    items.push({ file: f, title: j.name || '(untitled)', updated: j.updated_at, msgs: (j.chat_messages || []).length, chars });
  }
  items.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  lines.push(`## Claude (${items.length})`, '');
  lines.push('| Date | Title | Msgs | Chars | File |');
  lines.push('|---|---|---:|---:|---|');
  for (const it of items) {
    const date = (it.updated || '').slice(0, 10);
    const title = it.title.replace(/\|/g, '\\|').slice(0, 60);
    lines.push(`| ${date} | ${title} | ${it.msgs} | ${it.chars} | [\`${it.file.slice(0,8)}\`](claude/${it.file}) |`);
  }
  lines.push('');
}

// ChatGPT
{
  const dir = path.join(ROOT, 'chatgpt');
  const files = await listJSON(dir);
  const items = [];
  for (const f of files) {
    const j = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
    if (!j.mapping) continue;
    const chars = Object.values(j.mapping).reduce((s, n) => s + ((n.message?.content?.parts?.join?.('')) || '').length, 0);
    const msgs = Object.values(j.mapping).filter(n => n.message?.content?.parts?.length).length;
    const updated = j.update_time ? new Date(j.update_time * 1000).toISOString() : '';
    items.push({ file: f, title: j.title || '(untitled)', updated, msgs, chars });
  }
  items.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  lines.push(`## ChatGPT (${items.length})`, '');
  lines.push('| Date | Title | Msgs | Chars | File |');
  lines.push('|---|---|---:|---:|---|');
  for (const it of items) {
    const date = (it.updated || '').slice(0, 10);
    const title = it.title.replace(/\|/g, '\\|').slice(0, 60);
    lines.push(`| ${date} | ${title} | ${it.msgs} | ${it.chars} | [\`${it.file.slice(0,8)}\`](chatgpt/${it.file}) |`);
  }
  lines.push('');
}

// Gemini
{
  const dir = path.join(ROOT, 'gemini');
  const files = await listJSON(dir);
  const items = [];
  for (const f of files) {
    const j = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
    const chars = j.turns.reduce((s, t) => s + (t.text || '').length, 0);
    items.push({ file: f, title: j.title, synced: j.synced_at, turns: j.turns.length, chars });
  }
  items.sort((a, b) => a.title.localeCompare(b.title));
  lines.push(`## Gemini (${items.length})`, '');
  lines.push('| Title | Turns | Chars | File |');
  lines.push('|---|---:|---:|---|');
  for (const it of items) {
    const title = it.title.replace(/\|/g, '\\|').slice(0, 60);
    lines.push(`| ${title} | ${it.turns} | ${it.chars} | [\`${it.file.slice(0,8)}\`](gemini/${it.file}) |`);
  }
  lines.push('');
}

await fs.writeFile(path.join(ROOT, 'INDEX.md'), lines.join('\n'));
console.log(`wrote ${path.join(ROOT, 'INDEX.md')}`);
