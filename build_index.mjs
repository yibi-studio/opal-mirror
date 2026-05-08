#!/usr/bin/env node
// Build INDEX.md — a human-browsable table of all archived conversations.
//
// Reads JSON files from {AI_CHAT_ARCHIVE_DIR}/{claude,chatgpt,gemini,deepseek,doubao,qwen}/
// and writes INDEX.md alongside them.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.AI_CHAT_ARCHIVE_DIR || path.join(__dirname, 'ai-chat-archive');

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

// DeepSeek
{
  const dir = path.join(ROOT, 'deepseek');
  const files = await listJSON(dir);
  const items = [];
  for (const f of files) {
    const j = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
    const msgs = j.chat_messages || [];
    const chars = msgs.reduce((s, m) => {
      const txt = m.content || (m.fragments || []).map(fr => fr.content || '').join('');
      return s + (txt || '').length;
    }, 0);
    const updated = j.updated_at ? new Date(j.updated_at * 1000).toISOString() : '';
    items.push({ file: f, title: j.title || '(untitled)', updated, msgs: msgs.length, chars });
  }
  items.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  lines.push(`## DeepSeek (${items.length})`, '');
  lines.push('| Date | Title | Msgs | Chars | File |');
  lines.push('|---|---|---:|---:|---|');
  for (const it of items) {
    const date = (it.updated || '').slice(0, 10);
    const title = it.title.replace(/\|/g, '\\|').slice(0, 60);
    lines.push(`| ${date} | ${title} | ${it.msgs} | ${it.chars} | [\`${it.file.slice(0,8)}\`](deepseek/${it.file}) |`);
  }
  lines.push('');
}

// 豆包 (Doubao)
{
  const dir = path.join(ROOT, 'doubao');
  const files = await listJSON(dir);
  const items = [];
  for (const f of files) {
    const j = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
    const msgs = j.messages || [];
    const chars = msgs.reduce((s, m) => {
      let t = '';
      for (const b of (m.content_block || [])) {
        t += b?.content?.text_block?.text || '';
      }
      return s + t.length;
    }, 0);
    const updated = j.update_time ? new Date(Number(j.update_time) * 1000).toISOString() : '';
    items.push({ file: f, title: j.name || '(untitled)', updated, msgs: msgs.length, chars });
  }
  items.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  lines.push(`## 豆包 / Doubao (${items.length})`, '');
  lines.push('| Date | Title | Msgs | Chars | File |');
  lines.push('|---|---|---:|---:|---|');
  for (const it of items) {
    const date = (it.updated || '').slice(0, 10);
    const title = it.title.replace(/\|/g, '\\|').slice(0, 60);
    lines.push(`| ${date} | ${title} | ${it.msgs} | ${it.chars} | [\`${it.file.slice(0,8)}\`](doubao/${it.file}) |`);
  }
  lines.push('');
}

// 千问 (Qwen)
{
  const dir = path.join(ROOT, 'qwen');
  const files = await listJSON(dir);
  const items = [];
  for (const f of files) {
    const j = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
    const records = j.records || [];
    const chars = records.reduce((s, r) => {
      const req = (r.request_messages || []).map(m => m.content || '').join('');
      return s + req.length;
    }, 0);
    // updated_at can be ms-epoch number (e.g. 1778228458448) or ISO string
    let updated = '';
    if (typeof j.updated_at === 'number') updated = new Date(j.updated_at).toISOString();
    else if (typeof j.updated_at === 'string') updated = j.updated_at;
    items.push({ file: f, title: j.title || '(untitled)', updated, msgs: records.length, chars });
  }
  items.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  lines.push(`## 千问 / Qwen (${items.length})`, '');
  lines.push('| Date | Title | Records | Chars | File |');
  lines.push('|---|---|---:|---:|---|');
  for (const it of items) {
    const date = (it.updated || '').slice(0, 10);
    const title = it.title.replace(/\|/g, '\\|').slice(0, 60);
    lines.push(`| ${date} | ${title} | ${it.msgs} | ${it.chars} | [\`${it.file.slice(0,8)}\`](qwen/${it.file}) |`);
  }
  lines.push('');
}

await fs.writeFile(path.join(ROOT, 'INDEX.md'), lines.join('\n'));
console.log(`wrote ${path.join(ROOT, 'INDEX.md')}`);
